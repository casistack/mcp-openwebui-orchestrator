import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

const { NamespaceService } = await import('../services/namespace-service.js');

describe('NamespaceService', () => {
  let db: MockDatabase;
  let service: InstanceType<typeof NamespaceService>;

  beforeEach(() => {
    db = createMockDatabase();
    service = new NamespaceService(db as never);
  });

  describe('createNamespace', () => {
    it('should create namespace with correct defaults', async () => {
      const result = await service.createNamespace({
        name: 'My Namespace',
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe('My Namespace');
      expect(result.slug).toBe('my-namespace');
      expect(result.isPublic).toBe(false);
      expect(result.description).toBeNull();
      expect(result.createdBy).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should create public namespace with description', async () => {
      const result = await service.createNamespace({
        name: 'Public NS',
        description: 'A public namespace',
        isPublic: true,
        createdBy: 'user-1',
      });

      expect(result.isPublic).toBe(true);
      expect(result.description).toBe('A public namespace');
      expect(result.createdBy).toBe('user-1');
    });

    it('should sanitize slug from name', async () => {
      const result = await service.createNamespace({
        name: 'Complex Name!! With Spaces',
      });

      expect(result.slug).toBe('complex-name-with-spaces');
    });

    it('should collapse consecutive hyphens in slug', async () => {
      const result = await service.createNamespace({
        name: 'Test---Multiple',
      });

      expect(result.slug).toBe('test-multiple');
    });
  });

  describe('listNamespaces', () => {
    it('should return empty array initially', async () => {
      const result = await service.listNamespaces();
      expect(result).toEqual([]);
    });

    it('should return all namespaces', async () => {
      await service.createNamespace({ name: 'NS 1' });
      await service.createNamespace({ name: 'NS 2' });

      const result = await service.listNamespaces();
      expect(result).toHaveLength(2);
    });
  });

  describe('getNamespace', () => {
    it('should find namespace by ID', async () => {
      const created = await service.createNamespace({ name: 'Find Me' });

      const result = await service.getNamespace(created.id);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Find Me');
    });

    it('should return null for missing ID', async () => {
      const result = await service.getNamespace('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('getNamespaceBySlug', () => {
    it('should find namespace by slug', async () => {
      await service.createNamespace({ name: 'By Slug' });

      const result = await service.getNamespaceBySlug('by-slug');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('By Slug');
    });

    it('should return null for missing slug', async () => {
      const result = await service.getNamespaceBySlug('missing-slug');
      expect(result).toBeNull();
    });
  });

  describe('updateNamespace', () => {
    it('should return null for non-existent namespace', async () => {
      const result = await service.updateNamespace('bad-id', { name: 'New Name' });
      expect(result).toBeNull();
    });

    it('should update name and regenerate slug', async () => {
      const created = await service.createNamespace({ name: 'Original' });

      const result = await service.updateNamespace(created.id, { name: 'Updated Name' });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated Name');
      expect(result!.slug).toBe('updated-name');
      expect(db.update).toHaveBeenCalled();
    });

    it('should update description without changing name', async () => {
      const created = await service.createNamespace({ name: 'Keep Name' });

      const result = await service.updateNamespace(created.id, { description: 'New desc' });
      expect(result).not.toBeNull();
      expect(result!.description).toBe('New desc');
    });

    it('should update isPublic flag', async () => {
      const created = await service.createNamespace({ name: 'Private' });

      const result = await service.updateNamespace(created.id, { isPublic: true });
      expect(result).not.toBeNull();
      expect(result!.isPublic).toBe(true);
    });
  });

  describe('deleteNamespace', () => {
    it('should return false for non-existent namespace', async () => {
      const result = await service.deleteNamespace('missing');
      expect(result).toBe(false);
    });

    it('should call DELETE SQL for existing namespace', async () => {
      const created = await service.createNamespace({ name: 'Delete Me' });

      const result = await service.deleteNamespace(created.id);
      expect(result).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('server membership', () => {
    it('addServer should return null for non-existent namespace', async () => {
      const result = await service.addServer('bad-ns', 'server-1');
      expect(result).toBeNull();
    });

    it('addServer should insert a join record', async () => {
      const ns = await service.createNamespace({ name: 'With Servers' });

      const result = await service.addServer(ns.id, 'server-1');
      expect(result).not.toBeNull();
      expect(result!.namespaceId).toBe(ns.id);
      expect(result!.serverId).toBe('server-1');

      const joins = db._getTable('namespace_servers');
      expect(joins).toHaveLength(1);
    });

    it('removeServer should call DELETE SQL', async () => {
      const ns = await service.createNamespace({ name: 'Remove Test' });
      await service.addServer(ns.id, 'server-1');

      const result = await service.removeServer(ns.id, 'server-1');
      expect(result).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });

    it('listServers should return servers in namespace', async () => {
      const ns = await service.createNamespace({ name: 'List Servers' });

      // Pre-populate the servers table
      db._addRow('mcp_servers', { id: 'srv-1', name: 'Server 1' });
      db._addRow('mcp_servers', { id: 'srv-2', name: 'Server 2' });
      db._addRow('mcp_servers', { id: 'srv-3', name: 'Server 3' });

      // Add two servers to the namespace
      await service.addServer(ns.id, 'srv-1');
      await service.addServer(ns.id, 'srv-3');

      const servers = await service.listServers(ns.id);
      expect(servers).toHaveLength(2);
      expect(servers.map((s: { id: string }) => s.id).sort()).toEqual(['srv-1', 'srv-3']);
    });

    it('listServers should return empty array for namespace with no servers', async () => {
      const ns = await service.createNamespace({ name: 'Empty' });
      const servers = await service.listServers(ns.id);
      expect(servers).toEqual([]);
    });
  });

  describe('getNamespaceCount', () => {
    it('should return 0 initially', async () => {
      expect(await service.getNamespaceCount()).toBe(0);
    });

    it('should count correctly', async () => {
      await service.createNamespace({ name: 'A' });
      await service.createNamespace({ name: 'B' });
      expect(await service.getNamespaceCount()).toBe(2);
    });
  });
});
