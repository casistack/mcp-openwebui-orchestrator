import { EventEmitter } from 'events';
import { MCPClient, type MCPClientConfig, type MCPClientStatus, type MCPTool } from './mcp-client.js';
import type { ServerService } from './server-service.js';
import type { ToolConfigService } from './tool-config-service.js';

export interface ConnectionInfo {
  serverId: string;
  status: MCPClientStatus;
  tools: MCPTool[];
  lastPingMs: number | null;
  lastError: string | null;
  connectTime: Date | null;
  reconnectAttempts: number;
}

interface ManagedConnection {
  client: MCPClient;
  serverId: string;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastPingMs: number | null;
  lastError: string | null;
  connectTime: Date | null;
}

/**
 * Manages a pool of MCP client connections with lifecycle management.
 * Handles connect, disconnect, tool discovery, auto-reconnect, and health pings.
 */
export class ConnectionManager extends EventEmitter {
  private connections = new Map<string, ManagedConnection>();
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  static readonly MAX_RECONNECT_ATTEMPTS = 5;
  static readonly BASE_RECONNECT_DELAY = 2_000;
  static readonly HEALTH_CHECK_INTERVAL = 30_000;

  constructor(
    private serverService: ServerService,
    private toolConfigService: ToolConfigService,
  ) {
    super();
  }

  /**
   * Connect to an MCP server and begin managing the connection.
   */
  async connect(config: MCPClientConfig): Promise<MCPClient> {
    // Disconnect existing connection if any
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id);
    }

    const client = new MCPClient(config);
    const managed: ManagedConnection = {
      client,
      serverId: config.id,
      reconnectAttempts: 0,
      reconnectTimer: null,
      lastPingMs: null,
      lastError: null,
      connectTime: null,
    };

    this.connections.set(config.id, managed);

    // Wire up event handlers
    client.on('disconnected', () => {
      if (managed.reconnectTimer) return; // already reconnecting
      this.scheduleReconnect(config.id, config);
    });

    client.on('error', (err: Error) => {
      managed.lastError = err.message;
      this.emit('server:error', { serverId: config.id, error: err.message });
    });

    try {
      await client.connect();
      managed.connectTime = new Date();
      managed.reconnectAttempts = 0;

      // Update server status in DB
      await this.updateServerStatus(config.id, 'active');

      // Discover tools
      await this.discoverTools(config.id);

      this.emit('server:connected', { serverId: config.id });
      return client;
    } catch (err) {
      managed.lastError = (err as Error).message;
      await this.updateServerStatus(config.id, 'error');
      this.emit('server:error', { serverId: config.id, error: (err as Error).message });
      throw err;
    }
  }

  /**
   * Disconnect a managed server.
   */
  async disconnect(serverId: string): Promise<void> {
    const managed = this.connections.get(serverId);
    if (!managed) return;

    if (managed.reconnectTimer) {
      clearTimeout(managed.reconnectTimer);
      managed.reconnectTimer = null;
    }

    await managed.client.disconnect();
    this.connections.delete(serverId);
    await this.updateServerStatus(serverId, 'inactive');
    this.emit('server:disconnected', { serverId });
  }

  /**
   * Get a connected client for a server.
   */
  getClient(serverId: string): MCPClient | null {
    const managed = this.connections.get(serverId);
    if (!managed || managed.client.status !== 'connected') return null;
    return managed.client;
  }

  /**
   * Get connection info for a server.
   */
  getConnectionInfo(serverId: string): ConnectionInfo | null {
    const managed = this.connections.get(serverId);
    if (!managed) return null;

    return {
      serverId: managed.serverId,
      status: managed.client.status,
      tools: managed.client.tools,
      lastPingMs: managed.lastPingMs,
      lastError: managed.lastError,
      connectTime: managed.connectTime,
      reconnectAttempts: managed.reconnectAttempts,
    };
  }

  /**
   * List all managed connections.
   */
  listConnections(): ConnectionInfo[] {
    return Array.from(this.connections.values()).map(m => ({
      serverId: m.serverId,
      status: m.client.status,
      tools: m.client.tools,
      lastPingMs: m.lastPingMs,
      lastError: m.lastError,
      connectTime: m.connectTime,
      reconnectAttempts: m.reconnectAttempts,
    }));
  }

  /**
   * Check if a server is connected and ready.
   */
  isConnected(serverId: string): boolean {
    return this.getClient(serverId) !== null;
  }

  /**
   * Connect to all servers from the database.
   */
  async connectAll(): Promise<{ connected: number; failed: number }> {
    const servers = await this.serverService.listServers();
    let connected = 0;
    let failed = 0;

    for (const server of servers) {
      const config = this.serverToClientConfig(server);
      if (!config) {
        failed++;
        continue;
      }

      try {
        await this.connect(config);
        connected++;
      } catch {
        failed++;
      }
    }

    return { connected, failed };
  }

  /**
   * Disconnect all managed servers.
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.connections.keys());
    await Promise.all(serverIds.map(id => this.disconnect(id)));
  }

  /**
   * Start periodic health checks on all connected servers.
   */
  startHealthChecks(): void {
    if (this.healthInterval) return;

    this.healthInterval = setInterval(async () => {
      await this.pingAll();
    }, ConnectionManager.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  /**
   * Ping all connected servers and update health info.
   */
  async pingAll(): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();

    for (const [serverId, managed] of this.connections) {
      if (managed.client.status !== 'connected') {
        results.set(serverId, null);
        continue;
      }

      try {
        const { latencyMs } = await managed.client.ping();
        managed.lastPingMs = latencyMs;
        managed.lastError = null;
        results.set(serverId, latencyMs);
        this.emit('server:ping', { serverId, latencyMs });
      } catch (err) {
        managed.lastPingMs = null;
        managed.lastError = (err as Error).message;
        results.set(serverId, null);
        this.emit('server:ping:failed', { serverId, error: (err as Error).message });
      }
    }

    return results;
  }

  /**
   * Discover tools on a connected server and persist to DB.
   */
  async discoverTools(serverId: string, namespaceId?: string): Promise<MCPTool[]> {
    const client = this.getClient(serverId);
    if (!client) throw new Error(`Server ${serverId} not connected`);

    const tools = await client.listTools();

    // If we have a namespace context, persist tool configs
    if (namespaceId) {
      await this.persistTools(namespaceId, serverId, tools);
    }

    this.emit('server:tools', { serverId, tools });
    return tools;
  }

  /**
   * Discover tools for a server in all its namespaces.
   */
  async discoverAndPersistTools(serverId: string): Promise<MCPTool[]> {
    const client = this.getClient(serverId);
    if (!client) throw new Error(`Server ${serverId} not connected`);

    const tools = await client.listTools();

    // We don't persist without a namespace context here.
    // Tools get persisted when discoverTools is called with a namespaceId,
    // or when a namespace adds a server.
    this.emit('server:tools', { serverId, tools });
    return tools;
  }

  // --- Internal ---

  private async persistTools(namespaceId: string, serverId: string, tools: MCPTool[]): Promise<void> {
    const configs = tools.map(tool => ({
      namespaceId,
      serverId,
      toolName: tool.name,
      enabled: true,
      displayName: tool.name,
      description: tool.description ?? '',
    }));

    if (configs.length > 0) {
      await this.toolConfigService.bulkSetToolConfigs(configs);
    }
  }

  private scheduleReconnect(serverId: string, config: MCPClientConfig): void {
    const managed = this.connections.get(serverId);
    if (!managed) return;

    if (managed.reconnectAttempts >= ConnectionManager.MAX_RECONNECT_ATTEMPTS) {
      managed.lastError = `Max reconnect attempts (${ConnectionManager.MAX_RECONNECT_ATTEMPTS}) exceeded`;
      this.updateServerStatus(serverId, 'error');
      this.emit('server:reconnect:exhausted', { serverId });
      return;
    }

    managed.reconnectAttempts++;
    const delay = ConnectionManager.BASE_RECONNECT_DELAY * Math.pow(2, managed.reconnectAttempts - 1);

    this.emit('server:reconnecting', { serverId, attempt: managed.reconnectAttempts, delay });

    managed.reconnectTimer = setTimeout(async () => {
      managed.reconnectTimer = null;
      try {
        const client = new MCPClient(config);
        await client.connect();

        // Replace the client in the managed connection
        managed.client = client;
        managed.connectTime = new Date();
        managed.reconnectAttempts = 0;
        managed.lastError = null;

        // Re-wire events
        client.on('disconnected', () => {
          if (managed.reconnectTimer) return;
          this.scheduleReconnect(serverId, config);
        });
        client.on('error', (err: Error) => {
          managed.lastError = err.message;
        });

        await this.updateServerStatus(serverId, 'active');
        this.emit('server:reconnected', { serverId });
      } catch (err) {
        managed.lastError = (err as Error).message;
        this.scheduleReconnect(serverId, config);
      }
    }, delay);
  }

  private async updateServerStatus(serverId: string, status: string): Promise<void> {
    try {
      await this.serverService.updateServer(serverId, { status });
    } catch {
      // Non-critical - status update failed
    }
  }

  private serverToClientConfig(server: {
    id: string;
    transport: string;
    command?: string | null;
    args?: string[] | null;
    cwd?: string | null;
    url?: string | null;
    headers?: Record<string, string> | null;
  }): MCPClientConfig | null {
    const transport = server.transport as MCPClientConfig['transport'];

    if (transport === 'stdio') {
      if (!server.command) return null;
      return {
        id: server.id,
        transport,
        command: server.command,
        args: server.args ?? [],
        cwd: server.cwd ?? undefined,
      };
    }

    if (transport === 'sse' || transport === 'streamable-http') {
      if (!server.url) return null;
      return {
        id: server.id,
        transport,
        url: server.url,
        headers: server.headers ?? undefined,
      };
    }

    return null;
  }
}
