import { Router } from 'express';

/**
 * OpenAPI 3.1 specification for the MCP Platform API.
 */
function generateOpenAPISpec(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MCP Platform API',
      version: '0.1.0',
      description: 'Enterprise MCP server management platform with RBAC, audit logging, and container sandboxing.',
    },
    servers: [
      { url: '/api/v1', description: 'API v1' },
      { url: '/mcp', description: 'MCP Protocol endpoints' },
    ],
    paths: {
      '/servers': {
        get: {
          summary: 'List all MCP servers',
          tags: ['Servers'],
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'List of servers', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServerList' } } } } },
        },
        post: {
          summary: 'Create a new MCP server',
          tags: ['Servers'],
          security: [{ bearerAuth: [] }],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateServer' } } } },
          responses: { '201': { description: 'Server created' } },
        },
      },
      '/servers/{id}': {
        get: { summary: 'Get server by ID', tags: ['Servers'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Server details' } } },
        put: { summary: 'Update server', tags: ['Servers'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Server updated' } } },
        delete: { summary: 'Delete server', tags: ['Servers'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Server deleted' } } },
      },
      '/namespaces': {
        get: { summary: 'List namespaces', tags: ['Namespaces'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'List of namespaces' } } },
        post: { summary: 'Create namespace', tags: ['Namespaces'], security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateNamespace' } } } }, responses: { '201': { description: 'Namespace created' } } },
      },
      '/namespaces/{id}': {
        get: { summary: 'Get namespace', tags: ['Namespaces'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Namespace details' } } },
        put: { summary: 'Update namespace', tags: ['Namespaces'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Namespace updated' } } },
        delete: { summary: 'Delete namespace', tags: ['Namespaces'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Namespace deleted' } } },
      },
      '/namespaces/{id}/servers': {
        get: { summary: 'List servers in namespace', tags: ['Namespaces'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Namespace servers' } } },
        post: { summary: 'Add server to namespace', tags: ['Namespaces'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '201': { description: 'Server added' } } },
      },
      '/endpoints': {
        get: { summary: 'List endpoints', tags: ['Endpoints'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'List of endpoints' } } },
        post: { summary: 'Create endpoint', tags: ['Endpoints'], security: [{ bearerAuth: [] }], responses: { '201': { description: 'Endpoint created' } } },
      },
      '/endpoints/{id}': {
        delete: { summary: 'Delete endpoint', tags: ['Endpoints'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Endpoint deleted' } } },
      },
      '/api-keys': {
        get: { summary: 'List API keys', tags: ['API Keys'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'List of API keys' } } },
        post: { summary: 'Create API key', tags: ['API Keys'], security: [{ bearerAuth: [] }], responses: { '201': { description: 'API key created (raw key returned only once)' } } },
      },
      '/api-keys/{id}': {
        delete: { summary: 'Delete API key', tags: ['API Keys'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Key deleted' } } },
      },
      '/api-keys/{id}/revoke': {
        post: { summary: 'Revoke API key', tags: ['API Keys'], security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Key revoked' } } },
      },
      '/stats': {
        get: { summary: 'Dashboard statistics', tags: ['Stats'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Platform stats' } } },
      },
      '/admin/audit-logs': {
        get: { summary: 'List audit logs', tags: ['Admin'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Audit log entries' } } },
      },
      '/admin/users': {
        get: { summary: 'List users', tags: ['Admin'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'User list' } } },
      },
      '/import/claude-desktop': {
        post: { summary: 'Import from Claude Desktop config JSON', tags: ['Import/Export'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Import result' } } },
      },
      '/export/claude-desktop': {
        get: { summary: 'Export as Claude Desktop config', tags: ['Import/Export'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Claude Desktop JSON config' } } },
      },
      '/export/platform': {
        get: { summary: 'Export full platform config', tags: ['Import/Export'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Platform export JSON' } } },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API Key (mcp_...)' },
      },
      schemas: {
        ServerList: {
          type: 'object',
          properties: {
            servers: {
              type: 'array',
              items: { $ref: '#/components/schemas/Server' },
            },
          },
        },
        Server: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            displayName: { type: 'string' },
            transport: { type: 'string', enum: ['stdio', 'sse', 'streamable-http'] },
            status: { type: 'string' },
            command: { type: 'string', nullable: true },
            args: { type: 'array', items: { type: 'string' }, nullable: true },
            url: { type: 'string', nullable: true },
            proxyType: { type: 'string', nullable: true },
            needsProxy: { type: 'boolean' },
            isPublic: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        CreateServer: {
          type: 'object',
          required: ['name', 'transport'],
          properties: {
            name: { type: 'string' },
            transport: { type: 'string', enum: ['stdio', 'sse', 'streamable-http'] },
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            url: { type: 'string' },
            proxyType: { type: 'string' },
            needsProxy: { type: 'boolean' },
            isPublic: { type: 'boolean' },
          },
        },
        CreateNamespace: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            isPublic: { type: 'boolean' },
          },
        },
      },
    },
    tags: [
      { name: 'Servers', description: 'MCP server management' },
      { name: 'Namespaces', description: 'Logical server groupings' },
      { name: 'Endpoints', description: 'Public-facing MCP interfaces' },
      { name: 'API Keys', description: 'API key management' },
      { name: 'Stats', description: 'Platform statistics' },
      { name: 'Admin', description: 'Administration' },
      { name: 'Import/Export', description: 'Configuration import/export' },
    ],
  };
}

export function createOpenAPIRouter(): Router {
  const router = Router();
  const spec = generateOpenAPISpec();

  router.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });

  router.get('/docs', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><title>MCP Platform API</title>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></head>
<body><script id="api-reference" data-url="/api/openapi.json"></script></body></html>`);
  });

  return router;
}
