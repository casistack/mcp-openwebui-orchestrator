import crypto from 'crypto';
import { roles, permissions, rolePermissions, users, eq } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

// Permission format: "resource.action" e.g. "servers.read", "namespaces.write", "admin.users"
export const PERMISSIONS = {
  // Server management
  'servers.read': { resource: 'servers', action: 'read', description: 'View server list and details' },
  'servers.write': { resource: 'servers', action: 'write', description: 'Create, update, delete servers' },
  'servers.env': { resource: 'servers', action: 'env', description: 'Manage server environment variables' },

  // Namespace management
  'namespaces.read': { resource: 'namespaces', action: 'read', description: 'View namespaces' },
  'namespaces.write': { resource: 'namespaces', action: 'write', description: 'Create, update, delete namespaces' },
  'namespaces.members': { resource: 'namespaces', action: 'members', description: 'Manage namespace server membership' },

  // Endpoint management
  'endpoints.read': { resource: 'endpoints', action: 'read', description: 'View endpoints' },
  'endpoints.write': { resource: 'endpoints', action: 'write', description: 'Create, update, delete endpoints' },

  // Tool configuration
  'tools.read': { resource: 'tools', action: 'read', description: 'View tool configurations' },
  'tools.write': { resource: 'tools', action: 'write', description: 'Modify tool configurations' },

  // API key management
  'apikeys.read': { resource: 'apikeys', action: 'read', description: 'View own API keys' },
  'apikeys.write': { resource: 'apikeys', action: 'write', description: 'Create, revoke own API keys' },

  // Audit logs
  'audit.read': { resource: 'audit', action: 'read', description: 'View audit logs' },

  // Stats
  'stats.read': { resource: 'stats', action: 'read', description: 'View platform statistics' },

  // Admin
  'admin.users': { resource: 'admin', action: 'users', description: 'Manage users and role assignments' },
  'admin.roles': { resource: 'admin', action: 'roles', description: 'Manage roles and permissions' },
  'admin.system': { resource: 'admin', action: 'system', description: 'System configuration and maintenance' },
} as const;

export type PermissionName = keyof typeof PERMISSIONS;

// Default role definitions with their permissions
const DEFAULT_ROLES = {
  admin: {
    description: 'Full system access',
    permissions: Object.keys(PERMISSIONS) as PermissionName[],
  },
  operator: {
    description: 'Manage servers, namespaces, and endpoints',
    permissions: [
      'servers.read', 'servers.write', 'servers.env',
      'namespaces.read', 'namespaces.write', 'namespaces.members',
      'endpoints.read', 'endpoints.write',
      'tools.read', 'tools.write',
      'apikeys.read', 'apikeys.write',
      'audit.read',
      'stats.read',
    ] as PermissionName[],
  },
  user: {
    description: 'Read access and manage own API keys',
    permissions: [
      'servers.read',
      'namespaces.read',
      'endpoints.read',
      'tools.read',
      'apikeys.read', 'apikeys.write',
      'stats.read',
    ] as PermissionName[],
  },
  viewer: {
    description: 'Read-only access',
    permissions: [
      'servers.read',
      'namespaces.read',
      'endpoints.read',
      'tools.read',
      'stats.read',
    ] as PermissionName[],
  },
} as const;

export class RBACService {
  private readonly db: AppDatabase;
  // In-memory cache for fast permission checks
  private permissionCache = new Map<string, Set<string>>();
  private cacheExpiry = 0;
  private readonly cacheTTL = 60_000; // 1 minute

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async seedDefaults() {
    const existingRoles = await this.db.select().from(roles);
    if (existingRoles.length > 0) return;

    console.log('Seeding default RBAC roles and permissions...');

    // Insert all permissions
    for (const [name, def] of Object.entries(PERMISSIONS)) {
      await this.db.insert(permissions).values({
        id: crypto.randomUUID(),
        name,
        resource: def.resource,
        action: def.action,
        description: def.description,
        createdAt: new Date(),
      });
    }

    // Insert roles and map permissions
    const allPerms = await this.db.select().from(permissions);
    const permByName = new Map(allPerms.map(p => [p.name, p.id]));

    for (const [roleName, roleDef] of Object.entries(DEFAULT_ROLES)) {
      const roleId = crypto.randomUUID();
      await this.db.insert(roles).values({
        id: roleId,
        name: roleName,
        description: roleDef.description,
        isSystem: true,
        createdAt: new Date(),
      });

      for (const permName of roleDef.permissions) {
        const permId = permByName.get(permName);
        if (permId) {
          await this.db.insert(rolePermissions).values({
            roleId,
            permissionId: permId,
          });
        }
      }
    }

    console.log('RBAC seed complete: 4 roles, ' + allPerms.length + ' permissions');
    this.invalidateCache();
  }

  async hasPermission(userId: string, permission: PermissionName): Promise<boolean> {
    const userPerms = await this.getUserPermissions(userId);
    return userPerms.has(permission);
  }

  async getUserPermissions(userId: string): Promise<Set<string>> {
    // Check cache
    if (Date.now() < this.cacheExpiry) {
      const cached = this.permissionCache.get(userId);
      if (cached) return cached;
    }

    // Get user's role
    const allUsers = await this.db.select().from(users);
    const user = allUsers.find(u => u.id === userId);
    if (!user?.roleId) return new Set();

    // Get role's permissions
    const allRolePerms = await this.db.select().from(rolePermissions);
    const rolePermIds = allRolePerms
      .filter(rp => rp.roleId === user.roleId)
      .map(rp => rp.permissionId);

    const allPerms = await this.db.select().from(permissions);
    const permNames = new Set(
      allPerms.filter(p => rolePermIds.includes(p.id)).map(p => p.name),
    );

    // Cache result
    this.permissionCache.set(userId, permNames);
    if (Date.now() >= this.cacheExpiry) {
      this.cacheExpiry = Date.now() + this.cacheTTL;
    }

    return permNames;
  }

  async getUserRole(userId: string) {
    const allUsers = await this.db.select().from(users);
    const user = allUsers.find(u => u.id === userId);
    if (!user?.roleId) return null;

    const allRoles = await this.db.select().from(roles);
    return allRoles.find(r => r.id === user.roleId) ?? null;
  }

  async assignRole(userId: string, roleName: string) {
    const allRoles = await this.db.select().from(roles);
    const role = allRoles.find(r => r.name === roleName);
    if (!role) return false;

    try {
      await this.db.update(users).set({
        roleId: role.id,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
    } catch {
      return false;
    }

    this.invalidateCache();
    return true;
  }

  async listRoles() {
    return this.db.select().from(roles);
  }

  async listPermissions() {
    return this.db.select().from(permissions);
  }

  async getRolePermissions(roleId: string) {
    const allRolePerms = await this.db.select().from(rolePermissions);
    const permIds = allRolePerms.filter(rp => rp.roleId === roleId).map(rp => rp.permissionId);
    const allPerms = await this.db.select().from(permissions);
    return allPerms.filter(p => permIds.includes(p.id));
  }

  async listUsers() {
    const allUsers = await this.db.select().from(users);
    const allRoles = await this.db.select().from(roles);
    const roleMap = new Map(allRoles.map(r => [r.id, r]));

    return allUsers.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.roleId ? roleMap.get(u.roleId) ?? null : null,
      createdAt: u.createdAt,
    }));
  }

  async assignDefaultRoleToNewUser(userId: string) {
    // First user gets admin, rest get user role
    const allUsers = await this.db.select().from(users);
    const roleName = allUsers.length <= 1 ? 'admin' : 'user';
    return this.assignRole(userId, roleName);
  }

  invalidateCache() {
    this.permissionCache.clear();
    this.cacheExpiry = 0;
  }
}
