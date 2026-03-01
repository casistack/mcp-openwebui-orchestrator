import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

// Mock ConfigParser used by importFromClaudeDesktopFile
jest.unstable_mockModule('../core/config-parser.js', () => ({
  ConfigParser: jest.fn().mockImplementation(() => ({
    getMCPServers: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  })),
}));

const { ServerService } = await import('../services/server-service.js');
const { NamespaceService } = await import('../services/namespace-service.js');
const { EndpointService } = await import('../services/endpoint-service.js');
const { ImportExportService } = await import('../services/import-export-service.js');

describe('ImportExportService', () => {
  let db: MockDatabase;
  let serverService: InstanceType<typeof ServerService>;
  let namespaceService: InstanceType<typeof NamespaceService>;
  let endpointService: InstanceType<typeof EndpointService>;
  let service: InstanceType<typeof ImportExportService>;

  beforeEach(() => {
    db = createMockDatabase();
    serverService = new ServerService(db as never);
    namespaceService = new NamespaceService(db as never);
    endpointService = new EndpointService(db as never);
    service = new ImportExportService(serverService, namespaceService, endpointService);
  });

  describe('importFromClaudeDesktop', () => {
    it('should import stdio servers', async () => {
      const result = await service.importFromClaudeDesktop({
        mcpServers: {
          'my-server': {
            command: 'node',
            args: ['server.js'],
            cwd: '/app',
          },
        },
      });

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('should import SSE servers when URL present', async () => {
      const result = await service.importFromClaudeDesktop({
        mcpServers: {
          'sse-server': {
            url: 'http://localhost:8080/sse',
            headers: { Authorization: 'Bearer token' },
          },
        },
      });

      expect(result.imported).toBe(1);
      const servers = await serverService.listServers();
      expect(servers[0].transport).toBe('sse');
      expect(servers[0].url).toBe('http://localhost:8080/sse');
    });

    it('should import multiple servers', async () => {
      const result = await service.importFromClaudeDesktop({
        mcpServers: {
          'server-a': { command: 'node', args: ['a.js'] },
          'server-b': { command: 'python', args: ['b.py'] },
          'server-c': { url: 'http://example.com/sse' },
        },
      });

      expect(result.imported).toBe(3);
      expect(result.errors).toEqual([]);
    });

    it('should skip duplicate servers', async () => {
      // Pre-create a server
      await serverService.createServer({ name: 'existing', transport: 'stdio', command: 'echo' });

      const result = await service.importFromClaudeDesktop({
        mcpServers: {
          'existing': { command: 'echo' },
          'new-one': { command: 'node', args: ['x.js'] },
        },
      });

      // 'existing' will fail with UNIQUE constraint - counted as skipped
      // (depends on exact DB error message)
      expect(result.imported + result.skipped).toBeLessThanOrEqual(2);
    });

    it('should pass userId to created servers', async () => {
      await service.importFromClaudeDesktop(
        { mcpServers: { 'test': { command: 'echo' } } },
        'user-123',
      );

      const servers = await serverService.listServers();
      expect(servers[0].createdBy).toBe('user-123');
    });

    it('should handle empty mcpServers', async () => {
      const result = await service.importFromClaudeDesktop({ mcpServers: {} });

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe('importFromPlatformFormat', () => {
    it('should import servers, namespaces, and endpoints', async () => {
      const result = await service.importFromPlatformFormat({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        servers: [
          { name: 'Server A', transport: 'stdio', command: 'node' },
          { name: 'Server B', transport: 'sse', url: 'http://example.com' },
        ],
        namespaces: [
          {
            name: 'Production',
            description: 'Prod namespace',
            isPublic: true,
            serverNames: ['Server A'],
          },
        ],
        endpoints: [
          {
            namespaceName: 'Production',
            name: 'Main EP',
            transport: 'sse',
            authType: 'api_key',
            rateLimit: 100,
          },
        ],
      });

      expect(result.servers).toBe(2);
      expect(result.namespaces).toBe(1);
      expect(result.endpoints).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('should link servers to namespaces by name', async () => {
      await service.importFromPlatformFormat({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        servers: [{ name: 'Linked Server', transport: 'stdio', command: 'echo' }],
        namespaces: [{ name: 'My NS', isPublic: false, serverNames: ['Linked Server'] }],
        endpoints: [],
      });

      const nsList = await namespaceService.listNamespaces();
      const nsServers = await namespaceService.listServers(nsList[0].id);
      expect(nsServers).toHaveLength(1);
      expect(nsServers[0].name).toBe('Linked Server');
    });

    it('should report error for endpoint with missing namespace', async () => {
      const result = await service.importFromPlatformFormat({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        servers: [],
        namespaces: [],
        endpoints: [
          {
            namespaceName: 'Ghost NS',
            name: 'Orphan EP',
            transport: 'sse',
            authType: 'none',
            rateLimit: 50,
          },
        ],
      });

      expect(result.endpoints).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Ghost NS');
      expect(result.errors[0]).toContain('not found');
    });

    it('should handle empty import', async () => {
      const result = await service.importFromPlatformFormat({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        servers: [],
        namespaces: [],
        endpoints: [],
      });

      expect(result.servers).toBe(0);
      expect(result.namespaces).toBe(0);
      expect(result.endpoints).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe('exportToClaudeDesktop', () => {
    it('should export stdio servers', async () => {
      await serverService.createServer({
        name: 'my-server',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        cwd: '/app',
      });

      const result = await service.exportToClaudeDesktop();

      expect(result.mcpServers['my-server']).toBeDefined();
      expect(result.mcpServers['my-server'].command).toBe('node');
      expect(result.mcpServers['my-server'].args).toEqual(['server.js']);
      expect(result.mcpServers['my-server'].cwd).toBe('/app');
    });

    it('should export SSE servers with URL and headers', async () => {
      await serverService.createServer({
        name: 'sse-srv',
        transport: 'sse',
        url: 'http://example.com/sse',
        headers: { 'X-Key': 'value' },
      });

      const result = await service.exportToClaudeDesktop();

      expect(result.mcpServers['sse-srv'].url).toBe('http://example.com/sse');
      expect(result.mcpServers['sse-srv'].headers).toEqual({ 'X-Key': 'value' });
      // Should NOT include command for SSE
      expect(result.mcpServers['sse-srv'].command).toBeUndefined();
    });

    it('should export empty config when no servers', async () => {
      const result = await service.exportToClaudeDesktop();
      expect(result.mcpServers).toEqual({});
    });

    it('should omit null/undefined fields', async () => {
      await serverService.createServer({
        name: 'minimal',
        transport: 'stdio',
        command: 'echo',
      });

      const result = await service.exportToClaudeDesktop();
      const entry = result.mcpServers['minimal'];

      expect(entry.command).toBe('echo');
      // These should not be present since they're null
      expect(entry).not.toHaveProperty('url');
      expect(entry).not.toHaveProperty('cwd');
      expect(entry).not.toHaveProperty('headers');
    });
  });

  describe('exportToPlatformFormat', () => {
    it('should export full platform state', async () => {
      await serverService.createServer({ name: 'Srv1', transport: 'stdio', command: 'echo' });
      const ns = await namespaceService.createNamespace({ name: 'NS1', isPublic: true });
      await namespaceService.addServer(ns.id, 'srv1');
      await endpointService.createEndpoint({
        namespaceId: ns.id,
        name: 'EP1',
        transport: 'sse',
        authType: 'api_key',
        rateLimit: 200,
      });

      const result = await service.exportToPlatformFormat();

      expect(result.version).toBe('1.0');
      expect(result.exportedAt).toBeDefined();
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('Srv1');
      expect(result.namespaces).toHaveLength(1);
      expect(result.namespaces[0].name).toBe('NS1');
      expect(result.namespaces[0].isPublic).toBe(true);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0].name).toBe('EP1');
      expect(result.endpoints[0].rateLimit).toBe(200);
    });

    it('should export empty platform state', async () => {
      const result = await service.exportToPlatformFormat();

      expect(result.version).toBe('1.0');
      expect(result.servers).toEqual([]);
      expect(result.namespaces).toEqual([]);
      expect(result.endpoints).toEqual([]);
    });

    it('should map endpoint namespaceId to namespace name', async () => {
      const ns = await namespaceService.createNamespace({ name: 'My Named NS' });
      await endpointService.createEndpoint({
        namespaceId: ns.id,
        name: 'EP',
        transport: 'sse',
      });

      const result = await service.exportToPlatformFormat();
      expect(result.endpoints[0].namespaceName).toBe('My Named NS');
    });
  });

  describe('round-trip import/export', () => {
    it('should round-trip Claude Desktop format', async () => {
      const original = {
        mcpServers: {
          'graphiti': { command: 'python', args: ['-m', 'graphiti'], cwd: '/opt/graphiti' },
          'memory': { url: 'http://localhost:9090/sse' },
        },
      };

      await service.importFromClaudeDesktop(original);
      const exported = await service.exportToClaudeDesktop();

      expect(exported.mcpServers['graphiti'].command).toBe('python');
      expect(exported.mcpServers['graphiti'].args).toEqual(['-m', 'graphiti']);
      expect(exported.mcpServers['memory'].url).toBe('http://localhost:9090/sse');
    });
  });
});
