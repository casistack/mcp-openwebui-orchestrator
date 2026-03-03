import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

const { ToolPermissionService } = await import('../services/tool-permission-service.js');

describe('ToolPermissionService', () => {
  let service: InstanceType<typeof ToolPermissionService>;
  let mockDb: MockDatabase;

  beforeEach(() => {
    mockDb = createMockDatabase();
    service = new ToolPermissionService(mockDb as any);
  });

  describe('getPermissions', () => {
    it('should return empty array when no permissions', async () => {
      const result = await service.getPermissions('ns-1');
      expect(result).toEqual([]);
    });

    it('should return permissions for namespace', async () => {
      mockDb._addRow('user_tool_permissions', {
        id: 'perm-1',
        userId: 'user-1',
        namespaceId: 'ns-1',
        toolName: 'some_tool',
        allowed: false,
      });
      const result = await service.getPermissions('ns-1');
      expect(result).toHaveLength(1);
      expect(result[0].toolName).toBe('some_tool');
      expect(result[0].allowed).toBe(false);
    });

    it('should filter by userId when provided', async () => {
      mockDb._addRow('user_tool_permissions', {
        id: 'perm-1', userId: 'user-1', namespaceId: 'ns-1', toolName: 'tool-a', allowed: false,
      });
      mockDb._addRow('user_tool_permissions', {
        id: 'perm-2', userId: 'user-2', namespaceId: 'ns-1', toolName: 'tool-b', allowed: true,
      });
      const result = await service.getPermissions('ns-1', 'user-1');
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user-1');
    });
  });

  describe('setPermission', () => {
    it('should create a new permission', async () => {
      const result = await service.setPermission({
        userId: 'user-1',
        namespaceId: 'ns-1',
        toolName: 'dangerous_tool',
        allowed: false,
      });
      expect(result.userId).toBe('user-1');
      expect(result.toolName).toBe('dangerous_tool');
      expect(result.allowed).toBe(false);
      expect(result.id).toBeDefined();
    });
  });

  describe('checkAccess', () => {
    it('should return true when no rule exists (default allow)', async () => {
      const result = await service.checkAccess('user-1', 'ns-1', 'some_tool');
      expect(result).toBe(true);
    });

    it('should return false when blocked', async () => {
      mockDb._addRow('user_tool_permissions', {
        id: 'perm-1', userId: 'user-1', namespaceId: 'ns-1', toolName: 'blocked_tool', allowed: false,
      });
      const result = await service.checkAccess('user-1', 'ns-1', 'blocked_tool');
      expect(result).toBe(false);
    });

    it('should return true when explicitly allowed', async () => {
      mockDb._addRow('user_tool_permissions', {
        id: 'perm-1', userId: 'user-1', namespaceId: 'ns-1', toolName: 'allowed_tool', allowed: true,
      });
      const result = await service.checkAccess('user-1', 'ns-1', 'allowed_tool');
      expect(result).toBe(true);
    });
  });

  describe('getUserBlockedTools', () => {
    it('should return empty array when no blocked tools', async () => {
      const result = await service.getUserBlockedTools('user-1', 'ns-1');
      expect(result).toEqual([]);
    });

    it('should return only blocked tool names', async () => {
      mockDb._addRow('user_tool_permissions', {
        id: 'perm-1', userId: 'user-1', namespaceId: 'ns-1', toolName: 'blocked', allowed: false,
      });
      mockDb._addRow('user_tool_permissions', {
        id: 'perm-2', userId: 'user-1', namespaceId: 'ns-1', toolName: 'allowed', allowed: true,
      });
      const result = await service.getUserBlockedTools('user-1', 'ns-1');
      expect(result).toEqual(['blocked']);
    });
  });

  describe('deletePermission', () => {
    it('should return false for nonexistent permission', async () => {
      const result = await service.deletePermission('nonexistent');
      expect(result).toBe(false);
    });

    it('should delete existing permission', async () => {
      mockDb._addRow('user_tool_permissions', {
        id: 'perm-1', userId: 'user-1', namespaceId: 'ns-1', toolName: 'tool', allowed: false,
      });
      const result = await service.deletePermission('perm-1');
      expect(result).toBe(true);
    });
  });
});
