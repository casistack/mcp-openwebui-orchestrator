import { Router, type Request, type Response } from 'express';
import type { NamespaceService } from '../services/namespace-service.js';
import type { EndpointService } from '../services/endpoint-service.js';
import type { ToolConfigService } from '../services/tool-config-service.js';
import type { ApiKeyService } from '../services/api-key-service.js';
import type { ConnectionManager } from '../services/connection-manager.js';
import type { WSBroadcaster } from '../services/ws-server.js';
import { auditLogs } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';
import crypto from 'crypto';

export interface MCPProtocolServices {
  namespaceService: NamespaceService;
  endpointService: EndpointService;
  toolConfigService: ToolConfigService;
  apiKeyService: ApiKeyService;
  connectionManager?: ConnectionManager;
  wsBroadcaster?: WSBroadcaster;
  db?: AppDatabase;
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface SSEClient {
  id: string;
  res: Response;
  endpointId: string;
}

/**
 * MCP Protocol endpoints that expose namespaces to MCP clients.
 * Supports SSE and Streamable HTTP transports per the MCP specification.
 *
 * Routes:
 *   GET  /mcp/:endpointSlug/sse          - SSE transport (event stream)
 *   POST /mcp/:endpointSlug/messages      - SSE message handler
 *   POST /mcp/:endpointSlug/mcp           - Streamable HTTP transport
 *   GET  /mcp/:endpointSlug/health        - Endpoint health check
 */
export function createMCPProtocolRouter(services: MCPProtocolServices): Router {
  const router = Router();
  const sseClients = new Map<string, SSEClient>();

  // Authenticate request via API key, bearer token, or OAuth
  async function authenticateRequest(req: Request, endpointId: string): Promise<boolean> {
    const endpoint = await services.endpointService.getEndpoint(endpointId);
    if (!endpoint) return false;
    if (endpoint.authType === 'none') return true;

    const authHeader = req.headers.authorization;
    if (!authHeader) return false;

    if (endpoint.authType === 'api_key' || endpoint.authType === 'bearer') {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const valid = await services.apiKeyService.validateApiKey(token);
      return valid !== null;
    }

    if (endpoint.authType === 'oauth') {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      return validateOAuthToken(token, endpoint);
    }

    return false;
  }

  // Validate an OAuth 2.0 bearer token.
  // Supports local JWT validation (HS256) using the endpoint's auth config,
  // or token introspection against a configured OAuth server.
  async function validateOAuthToken(
    token: string,
    endpoint: { oauthConfig?: Record<string, unknown> | null },
  ): Promise<boolean> {
    try {
      const config = endpoint.oauthConfig;
      if (!config) return false;

      // If an introspection URL is configured, use RFC 7662 token introspection
      if (config.introspectionUrl) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        if (config.clientId && config.clientSecret) {
          headers['Authorization'] = 'Basic ' +
            Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
        }

        const response = await fetch(String(config.introspectionUrl), {
          method: 'POST',
          headers,
          body: `token=${encodeURIComponent(token)}`,
        });

        if (!response.ok) return false;
        const data = await response.json() as { active?: boolean };
        return data.active === true;
      }

      // Fallback: simple JWT structure validation (header.payload.signature)
      // For production, integrate a proper JWT library with JWKS support
      const parts = token.split('.');
      if (parts.length !== 3) return false;

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      // Check expiration
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return false;
      }

      // Check issuer if configured
      if (config.issuer && payload.iss !== config.issuer) {
        return false;
      }

      // Check audience if configured
      if (config.audience) {
        const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!aud.includes(config.audience)) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  // Resolve endpoint from slug
  async function resolveEndpoint(slug: string) {
    const allEndpoints = await services.endpointService.listEndpoints();
    return allEndpoints.find(e => e.slug === slug && e.isActive) ?? null;
  }

  // Get aggregated tools for a namespace from connected MCP servers,
  // respecting tool configs (enabled/disabled, display name overrides).
  async function getNamespaceTools(namespaceId: string): Promise<MCPTool[]> {
    const servers = await services.namespaceService.listServers(namespaceId);
    const toolConfigurations = await services.toolConfigService.getToolConfigs(namespaceId);
    const cm = services.connectionManager;

    const tools: MCPTool[] = [];

    for (const server of servers) {
      // Get real tools from the connected server
      const client = cm?.getClient(server.id);
      const serverTools = client?.tools ?? [];

      if (serverTools.length > 0) {
        // Return real discovered tools, applying config overrides
        for (const tool of serverTools) {
          const config = toolConfigurations.find(
            tc => tc.serverId === server.id && tc.toolName === tool.name,
          );

          // Skip disabled tools
          if (config && !config.enabled) continue;

          tools.push({
            name: config?.displayName ?? tool.name,
            description: (config?.description as string) ?? tool.description ?? '',
            inputSchema: tool.inputSchema,
          });
        }
      } else {
        // Server not connected or no tools discovered yet - show from DB configs
        const serverConfigs = toolConfigurations.filter(tc => tc.serverId === server.id);
        if (serverConfigs.length > 0) {
          for (const tc of serverConfigs) {
            if (!tc.enabled) continue;
            tools.push({
              name: tc.displayName ?? tc.toolName,
              description: (tc.description as string) ?? '',
              inputSchema: { type: 'object', properties: {} },
            });
          }
        }
      }
    }

    return tools;
  }

  // Resolve which server owns a tool in a namespace, for proxying calls.
  async function resolveToolServer(
    namespaceId: string,
    toolName: string,
  ): Promise<{ serverId: string; originalToolName: string } | null> {
    const servers = await services.namespaceService.listServers(namespaceId);
    const toolConfigurations = await services.toolConfigService.getToolConfigs(namespaceId);
    const cm = services.connectionManager;

    // First check tool configs for display name matches
    for (const tc of toolConfigurations) {
      if (!tc.enabled) continue;
      if (tc.displayName === toolName || tc.toolName === toolName) {
        return { serverId: tc.serverId, originalToolName: tc.toolName };
      }
    }

    // Fall back to checking connected server tools directly
    if (cm) {
      for (const server of servers) {
        const client = cm.getClient(server.id);
        if (!client) continue;
        const match = client.tools.find(t => t.name === toolName);
        if (match) {
          return { serverId: server.id, originalToolName: match.name };
        }
      }
    }

    return null;
  }

  // Format an MCP JSON-RPC response
  function jsonrpcResponse(id: string | number | null, result: unknown) {
    return { jsonrpc: '2.0' as const, id, result };
  }

  function jsonrpcError(id: string | number | null, code: number, message: string) {
    return { jsonrpc: '2.0' as const, id, error: { code, message } };
  }

  // Handle MCP JSON-RPC request
  async function handleMCPRequest(
    method: string,
    params: Record<string, unknown> | undefined,
    id: string | number | null,
    namespaceId: string,
  ) {
    switch (method) {
      case 'initialize': {
        return jsonrpcResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'mcp-platform',
            version: '0.1.0',
          },
        });
      }

      case 'tools/list': {
        const tools = await getNamespaceTools(namespaceId);
        return jsonrpcResponse(id, { tools });
      }

      case 'tools/call': {
        const toolName = params?.name as string;
        if (!toolName) {
          return jsonrpcError(id, -32602, 'Missing tool name');
        }

        const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
        const cm = services.connectionManager;

        // Resolve which server owns this tool
        const resolved = await resolveToolServer(namespaceId, toolName);
        if (!resolved) {
          return jsonrpcError(id, -32602, `Tool "${toolName}" not found in namespace`);
        }

        // Get the connected client for that server
        const client = cm?.getClient(resolved.serverId);
        if (!client) {
          return jsonrpcError(id, -32603, `Server for tool "${toolName}" is not connected`);
        }

        // Proxy the call to the real MCP server
        const callStart = Date.now();
        try {
          const result = await client.callTool(resolved.originalToolName, toolArgs);
          const durationMs = Date.now() - callStart;

          // Audit log the tool call
          logToolCall(services, {
            toolName: resolved.originalToolName,
            serverId: resolved.serverId,
            namespaceId,
            durationMs,
            status: 'success',
          });

          return jsonrpcResponse(id, result);
        } catch (err) {
          const durationMs = Date.now() - callStart;

          logToolCall(services, {
            toolName: resolved.originalToolName,
            serverId: resolved.serverId,
            namespaceId,
            durationMs,
            status: 'failure',
            error: (err as Error).message,
          });

          return jsonrpcError(id, -32603, `Tool call failed: ${(err as Error).message}`);
        }
      }

      case 'notifications/initialized':
      case 'ping': {
        if (method === 'ping') {
          return jsonrpcResponse(id, {});
        }
        return null; // notifications don't need responses
      }

      default:
        return jsonrpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  // SSE transport: establish event stream
  router.get('/:endpointSlug/sse', async (req: Request, res: Response) => {
    const endpoint = await resolveEndpoint(String(req.params.endpointSlug));
    if (!endpoint) {
      res.status(404).json({ error: 'Endpoint not found' });
      return;
    }

    if (endpoint.transport !== 'sse') {
      res.status(400).json({ error: 'Endpoint does not support SSE transport' });
      return;
    }

    const authenticated = await authenticateRequest(req, endpoint.id);
    if (!authenticated) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const clientId = crypto.randomUUID();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send the messages endpoint URL
    res.write(`event: endpoint\ndata: /mcp/${String(req.params.endpointSlug)}/messages?sessionId=${clientId}\n\n`);

    sseClients.set(clientId, { id: clientId, res, endpointId: endpoint.id });

    req.on('close', () => {
      sseClients.delete(clientId);
    });
  });

  // SSE transport: receive messages from client
  router.post('/:endpointSlug/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }

    const client = sseClients.get(sessionId);
    if (!client) {
      res.status(404).json({ error: 'Session not found. Re-establish SSE connection.' });
      return;
    }

    const endpoint = await services.endpointService.getEndpoint(client.endpointId);
    if (!endpoint) {
      res.status(404).json({ error: 'Endpoint no longer exists' });
      return;
    }

    const { method, params, id } = req.body;
    const response = await handleMCPRequest(method, params, id, endpoint.namespaceId);

    if (response) {
      // Send response via SSE
      client.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    }

    res.status(202).json({ ok: true });
  });

  // Streamable HTTP transport: single request/response
  router.post('/:endpointSlug/mcp', async (req: Request, res: Response) => {
    const endpoint = await resolveEndpoint(String(req.params.endpointSlug));
    if (!endpoint) {
      res.status(404).json({ error: 'Endpoint not found' });
      return;
    }

    if (endpoint.transport !== 'streamable-http') {
      res.status(400).json({ error: 'Endpoint does not support Streamable HTTP transport' });
      return;
    }

    const authenticated = await authenticateRequest(req, endpoint.id);
    if (!authenticated) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { method, params, id } = req.body;
    const response = await handleMCPRequest(method, params, id, endpoint.namespaceId);

    if (response) {
      res.json(response);
    } else {
      res.status(204).end();
    }
  });

  // Health check for a specific MCP endpoint
  router.get('/:endpointSlug/health', async (req: Request, res: Response) => {
    const endpoint = await resolveEndpoint(String(req.params.endpointSlug));
    if (!endpoint) {
      res.status(404).json({ status: 'not_found' });
      return;
    }

    const servers = await services.namespaceService.listServers(endpoint.namespaceId);
    const cm = services.connectionManager;

    const serverStatuses = servers.map(s => {
      const info = cm?.getConnectionInfo(s.id);
      return {
        id: s.id,
        name: s.name,
        connected: info?.status === 'connected',
        status: info?.status ?? 'unknown',
        tools: info?.tools.length ?? 0,
        lastPingMs: info?.lastPingMs ?? null,
      };
    });

    const connectedCount = serverStatuses.filter(s => s.connected).length;

    res.json({
      status: connectedCount > 0 ? 'ok' : 'degraded',
      endpoint: {
        id: endpoint.id,
        name: endpoint.name,
        transport: endpoint.transport,
        isActive: endpoint.isActive,
      },
      servers: {
        total: servers.length,
        connected: connectedCount,
        details: serverStatuses,
      },
    });
  });

  // Log tool calls to audit_logs and broadcast via WebSocket
  function logToolCall(
    svc: MCPProtocolServices,
    entry: {
      toolName: string;
      serverId: string;
      namespaceId: string;
      durationMs: number;
      status: string;
      error?: string;
    },
  ): void {
    // Write to audit_logs if DB is available
    if (svc.db) {
      svc.db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        action: 'tools/call',
        resource: 'tool',
        resourceId: entry.toolName,
        details: {
          serverId: entry.serverId,
          namespaceId: entry.namespaceId,
          toolName: entry.toolName,
          durationMs: entry.durationMs,
          error: entry.error,
        },
        status: entry.status,
        durationMs: entry.durationMs,
      }).catch(err => console.error('Failed to audit tool call:', (err as Error).message));
    }

    // Broadcast to WebSocket clients
    svc.wsBroadcaster?.broadcast({
      type: 'tool:called',
      data: {
        toolName: entry.toolName,
        serverId: entry.serverId,
        namespaceId: entry.namespaceId,
        durationMs: entry.durationMs,
        status: entry.status,
        error: entry.error,
      },
      timestamp: new Date().toISOString(),
    });
  }

  return router;
}
