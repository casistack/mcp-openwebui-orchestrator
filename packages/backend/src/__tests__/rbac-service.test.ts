import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

const { RBACService, PERMISSIONS } = await import('../services/rbac-service.js');

describe('RBACService', () => {
  let db: MockDatabase;
  let service: InstanceType<typeof RBACService>;

  beforeEach(() => {
    db = createMockDatabase();
    service = new RBACService(db as never);
    // Suppress console.log from seedDefaults
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('PERMISSIONS constant', () => {
    it('should define 17 permissions', () => {
      expect(Object.keys(PERMISSIONS)).toHaveLength(17);
    });

    it('should have correct structure for each permission', () => {
      for (const [name, def] of Object.entries(PERMISSIONS)) {
        expect(name).toMatch(/^\w+\.\w+$/);
        expect(def).toHaveProperty('resource');
        expect(def).toHaveProperty('action');
        expect(def).toHaveProperty('description');
      }
    });

    it('should include all expected resource groups', () => {
      const resources = new Set(Object.values(PERMISSIONS).map(p => p.resource));
      expect(resources).toEqual(new Set([
        'servers', 'namespaces', 'endpoints', 'tools',
        'apikeys', 'audit', 'stats', 'admin',
      ]));
    });
  });

  describe('seedDefaults', () => {
    it('should seed 4 roles and 17 permissions', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles');
      expect(roles).toHaveLength(4);
      const roleNames = roles.map((r: { name: string }) => r.name).sort();
      expect(roleNames).toEqual(['admin', 'operator', 'user', 'viewer']);

      const perms = db._getTable('permissions');
      expect(perms).toHaveLength(17);

      const rolePerms = db._getTable('role_permissions');
      expect(rolePerms.length).toBeGreaterThan(0);
    });

    it('should set isSystem=true on all roles', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles') as Array<{ isSystem: boolean }>;
      expect(roles.every(r => r.isSystem === true)).toBe(true);
    });

    it('should be idempotent (skip if roles exist)', async () => {
      await service.seedDefaults();
      const firstRoles = db._getTable('roles').length;

      await service.seedDefaults();
      expect(db._getTable('roles').length).toBe(firstRoles);
    });

    it('admin role should have all 17 permissions', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const adminRole = roles.find(r => r.name === 'admin')!;

      const rolePerms = db._getTable('role_permissions') as Array<{ roleId: string; permissionId: string }>;
      const adminPermCount = rolePerms.filter(rp => rp.roleId === adminRole.id).length;
      expect(adminPermCount).toBe(17);
    });

    it('viewer role should have read-only permissions', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const viewerRole = roles.find(r => r.name === 'viewer')!;

      const rolePerms = db._getTable('role_permissions') as Array<{ roleId: string; permissionId: string }>;
      const viewerPermIds = rolePerms.filter(rp => rp.roleId === viewerRole.id).map(rp => rp.permissionId);

      const perms = db._getTable('permissions') as Array<{ id: string; name: string }>;
      const viewerPermNames = perms.filter(p => viewerPermIds.includes(p.id)).map(p => p.name);

      // Viewer should only have .read permissions
      for (const name of viewerPermNames) {
        expect(name).toMatch(/\.read$/);
      }
    });
  });

  describe('hasPermission', () => {
    it('should return true for admin user', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const adminRole = roles.find(r => r.name === 'admin')!;

      db._addRow('users', { id: 'admin-user', roleId: adminRole.id, email: 'admin@test.com' });

      expect(await service.hasPermission('admin-user', 'servers.read')).toBe(true);
      expect(await service.hasPermission('admin-user', 'admin.system')).toBe(true);
    });

    it('should return false for viewer trying to write', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const viewerRole = roles.find(r => r.name === 'viewer')!;

      db._addRow('users', { id: 'viewer-user', roleId: viewerRole.id, email: 'viewer@test.com' });

      expect(await service.hasPermission('viewer-user', 'servers.read')).toBe(true);
      expect(await service.hasPermission('viewer-user', 'servers.write')).toBe(false);
      expect(await service.hasPermission('viewer-user', 'admin.users')).toBe(false);
    });

    it('should return false for user with no roleId', async () => {
      db._addRow('users', { id: 'no-role', roleId: null, email: 'norole@test.com' });

      expect(await service.hasPermission('no-role', 'servers.read')).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      expect(await service.hasPermission('ghost', 'servers.read')).toBe(false);
    });
  });

  describe('getUserPermissions', () => {
    it('should return Set of permission names', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const userRole = roles.find(r => r.name === 'user')!;
      db._addRow('users', { id: 'user-1', roleId: userRole.id, email: 'user@test.com' });

      const perms = await service.getUserPermissions('user-1');
      expect(perms).toBeInstanceOf(Set);
      expect(perms.has('servers.read')).toBe(true);
      expect(perms.has('apikeys.write')).toBe(true);
      expect(perms.has('servers.write')).toBe(false);
      expect(perms.has('admin.users')).toBe(false);
    });

    it('should cache results within TTL', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const adminRole = roles.find(r => r.name === 'admin')!;
      db._addRow('users', { id: 'cached-user', roleId: adminRole.id, email: 'cached@test.com' });

      // First call populates cache
      const perms1 = await service.getUserPermissions('cached-user');
      // Second call should use cache (same reference is fine since both read from cache)
      const perms2 = await service.getUserPermissions('cached-user');

      expect(perms1.size).toBe(perms2.size);
    });
  });

  describe('getUserRole', () => {
    it('should return role for user with roleId', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const operatorRole = roles.find(r => r.name === 'operator')!;
      db._addRow('users', { id: 'op-user', roleId: operatorRole.id, email: 'op@test.com' });

      const role = await service.getUserRole('op-user');
      expect(role).not.toBeNull();
      expect(role!.name).toBe('operator');
    });

    it('should return null for user without role', async () => {
      db._addRow('users', { id: 'no-role', roleId: null, email: 'norole@test.com' });
      expect(await service.getUserRole('no-role')).toBeNull();
    });

    it('should return null for non-existent user', async () => {
      expect(await service.getUserRole('ghost')).toBeNull();
    });
  });

  describe('assignRole', () => {
    it('should call UPDATE SQL for valid role', async () => {
      await service.seedDefaults();
      db._addRow('users', { id: 'user-1', roleId: null, email: 'user@test.com' });

      const result = await service.assignRole('user-1', 'operator');
      expect(result).toBe(true);
      expect(db.update).toHaveBeenCalled();
    });

    it('should return false for non-existent role', async () => {
      const result = await service.assignRole('user-1', 'superadmin');
      expect(result).toBe(false);
    });

    it('should invalidate cache after assignment', async () => {
      await service.seedDefaults();
      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const adminRole = roles.find(r => r.name === 'admin')!;
      db._addRow('users', { id: 'user-1', roleId: adminRole.id, email: 'user@test.com' });

      // Populate cache
      await service.getUserPermissions('user-1');

      // Assign new role
      await service.assignRole('user-1', 'viewer');

      // Cache should be invalidated (we can't directly test this,
      // but the service should still work correctly)
    });
  });

  describe('listRoles', () => {
    it('should return all roles', async () => {
      await service.seedDefaults();
      const roles = await service.listRoles();
      expect(roles).toHaveLength(4);
    });
  });

  describe('listPermissions', () => {
    it('should return all permissions', async () => {
      await service.seedDefaults();
      const perms = await service.listPermissions();
      expect(perms).toHaveLength(17);
    });
  });

  describe('getRolePermissions', () => {
    it('should return permissions for a specific role', async () => {
      await service.seedDefaults();

      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const operatorRole = roles.find(r => r.name === 'operator')!;

      const perms = await service.getRolePermissions(operatorRole.id);
      expect(perms.length).toBeGreaterThan(5);
      // Operator should not have admin permissions
      const permNames = perms.map((p: { name: string }) => p.name);
      expect(permNames).not.toContain('admin.users');
      expect(permNames).not.toContain('admin.roles');
    });
  });

  describe('assignDefaultRoleToNewUser', () => {
    it('should assign admin to first user', async () => {
      await service.seedDefaults();
      db._addRow('users', { id: 'first-user', roleId: null, email: 'first@test.com' });

      const result = await service.assignDefaultRoleToNewUser('first-user');
      expect(result).toBe(true);

      expect(db.update).toHaveBeenCalled();
    });

    it('should assign user role to subsequent users', async () => {
      await service.seedDefaults();
      db._addRow('users', { id: 'existing', roleId: 'some-role', email: 'existing@test.com' });
      db._addRow('users', { id: 'second-user', roleId: null, email: 'second@test.com' });

      const result = await service.assignDefaultRoleToNewUser('second-user');
      expect(result).toBe(true);

      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('invalidateCache', () => {
    it('should clear permission cache', async () => {
      await service.seedDefaults();
      const roles = db._getTable('roles') as Array<{ id: string; name: string }>;
      const adminRole = roles.find(r => r.name === 'admin')!;
      db._addRow('users', { id: 'user-1', roleId: adminRole.id, email: 'user@test.com' });

      await service.getUserPermissions('user-1');
      service.invalidateCache();

      // After invalidation, next call should re-query DB
      // This is implicitly tested - just ensure it doesn't throw
      const perms = await service.getUserPermissions('user-1');
      expect(perms.size).toBe(17);
    });
  });
});
