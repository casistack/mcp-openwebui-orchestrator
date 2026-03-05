import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

// Mock the @mcp-platform/db module
jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

const { ServerService } = await import('../services/server-service.js');

describe('ServerService', () => {
  let db: MockDatabase;
  let service: InstanceType<typeof ServerService>;

  beforeEach(() => {
    db = createMockDatabase();
    service = new ServerService(db as never);
  });

  describe('createServer', () => {
    it('should create a stdio server with correct defaults', async () => {
      const result = await service.createServer({
        name: 'Test Server',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      });

      expect(result.id).toBe('test-server');
      expect(result.name).toBe('Test Server');
      expect(result.transport).toBe('stdio');
      expect(result.command).toBe('node');
      expect(result.args).toEqual(['server.js']);
      expect(result.status).toBe('inactive');
      expect(result.proxyType).toBe('mcpo');
      expect(result.needsProxy).toBe(true);
      expect(result.isPublic).toBe(false);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should create an SSE server with URL', async () => {
      const result = await service.createServer({
        name: 'SSE Server',
        transport: 'sse',
        url: 'http://localhost:8080/sse',
        headers: { Authorization: 'Bearer token' },
      });

      expect(result.id).toBe('sse-server');
      expect(result.transport).toBe('sse');
      expect(result.url).toBe('http://localhost:8080/sse');
      expect(result.headers).toEqual({ Authorization: 'Bearer token' });
      expect(result.command).toBeNull();
    });

    it('should sanitize name to create ID', async () => {
      const result = await service.createServer({
        name: 'My Complex Server Name!@#$',
        transport: 'stdio',
      });

      expect(result.id).toBe('my-complex-server-name----');
    });

    it('should store the server in the database', async () => {
      await service.createServer({
        name: 'DB Test',
        transport: 'stdio',
        command: 'echo',
      });

      const rows = db._getTable('mcp_servers');
      expect(rows).toHaveLength(1);
      expect((rows[0] as { name: string }).name).toBe('DB Test');
    });

    it('should set createdBy when provided', async () => {
      const result = await service.createServer({
        name: 'Owned Server',
        transport: 'stdio',
        createdBy: 'user-123',
      });

      expect(result.createdBy).toBe('user-123');
    });
  });

  describe('listServers', () => {
    it('should return empty array when no servers exist', async () => {
      const result = await service.listServers();
      expect(result).toEqual([]);
    });

    it('should return all servers', async () => {
      await service.createServer({ name: 'Server A', transport: 'stdio' });
      await service.createServer({ name: 'Server B', transport: 'sse', url: 'http://example.com' });

      const result = await service.listServers();
      expect(result).toHaveLength(2);
    });
  });

  describe('getServer', () => {
    it('should return server by ID', async () => {
      await service.createServer({ name: 'Find Me', transport: 'stdio', command: 'node' });

      const result = await service.getServer('find-me');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Find Me');
    });

    it('should return null for non-existent server', async () => {
      const result = await service.getServer('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateServer', () => {
    it('should return null for non-existent server', async () => {
      const result = await service.updateServer('nonexistent', { description: 'test' });
      expect(result).toBeNull();
    });

    it('should merge updates with existing server', async () => {
      await service.createServer({ name: 'Update Me', transport: 'stdio', command: 'node' });

      const result = await service.updateServer('update-me', {
        description: 'Updated description',
        status: 'active',
      });

      expect(result).not.toBeNull();
      expect(result!.description).toBe('Updated description');
      expect(result!.status).toBe('active');
      expect(db.update).toHaveBeenCalled();
    });

    it('should skip undefined values in updates', async () => {
      await service.createServer({ name: 'Partial', transport: 'stdio' });

      const result = await service.updateServer('partial', {
        description: 'only this',
      });

      expect(result).not.toBeNull();
      expect(result!.description).toBe('only this');
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('deleteServer', () => {
    it('should return false for non-existent server', async () => {
      const result = await service.deleteServer('nonexistent');
      expect(result).toBe(false);
    });

    it('should delete existing server via db.delete', async () => {
      await service.createServer({ name: 'Delete Me', transport: 'stdio' });

      const result = await service.deleteServer('delete-me');
      expect(result).toBe(true);
    });
  });

  describe('getServerCount', () => {
    it('should return 0 when no servers exist', async () => {
      const count = await service.getServerCount();
      expect(count).toBe(0);
    });

    it('should return correct count', async () => {
      await service.createServer({ name: 'One', transport: 'stdio' });
      await service.createServer({ name: 'Two', transport: 'stdio' });
      await service.createServer({ name: 'Three', transport: 'sse', url: 'http://x' });

      const count = await service.getServerCount();
      expect(count).toBe(3);
    });
  });

  describe('setEnvVar', () => {
    it('should insert an env var with crypto values', async () => {
      const result = await service.setEnvVar('server-1', 'API_KEY', 'secret-value', true);

      expect(result.key).toBe('API_KEY');
      expect(result.isSecret).toBe(true);
      expect(result.id).toBeDefined();

      const rows = db._getTable('server_env_vars');
      expect(rows).toHaveLength(1);
      expect((rows[0] as { serverId: string }).serverId).toBe('server-1');
    });
  });

  describe('getEnvVars', () => {
    it('should return env vars filtered by serverId', async () => {
      await service.setEnvVar('server-1', 'KEY_A', 'val-a');
      await service.setEnvVar('server-1', 'KEY_B', 'val-b');
      await service.setEnvVar('server-2', 'KEY_C', 'val-c');

      const vars = await service.getEnvVars('server-1');
      expect(vars).toHaveLength(2);
      expect(vars.every((v: { serverId: string }) => v.serverId === 'server-1')).toBe(true);
    });

    it('should return empty array for server with no env vars', async () => {
      const vars = await service.getEnvVars('no-vars');
      expect(vars).toEqual([]);
    });
  });
});
