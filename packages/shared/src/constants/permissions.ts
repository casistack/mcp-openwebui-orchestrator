export const RBAC_PERMISSIONS = {
  // Server permissions
  'servers:create': { resource: 'servers', action: 'create' },
  'servers:read': { resource: 'servers', action: 'read' },
  'servers:update': { resource: 'servers', action: 'update' },
  'servers:delete': { resource: 'servers', action: 'delete' },
  'servers:execute': { resource: 'servers', action: 'execute' },

  // Namespace permissions
  'namespaces:create': { resource: 'namespaces', action: 'create' },
  'namespaces:read': { resource: 'namespaces', action: 'read' },
  'namespaces:update': { resource: 'namespaces', action: 'update' },
  'namespaces:delete': { resource: 'namespaces', action: 'delete' },

  // Endpoint permissions
  'endpoints:create': { resource: 'endpoints', action: 'create' },
  'endpoints:read': { resource: 'endpoints', action: 'read' },
  'endpoints:update': { resource: 'endpoints', action: 'update' },
  'endpoints:delete': { resource: 'endpoints', action: 'delete' },

  // User management permissions
  'users:create': { resource: 'users', action: 'create' },
  'users:read': { resource: 'users', action: 'read' },
  'users:update': { resource: 'users', action: 'update' },
  'users:delete': { resource: 'users', action: 'delete' },

  // Audit permissions
  'audit:read': { resource: 'audit', action: 'read' },

  // API key permissions
  'apikeys:create': { resource: 'apikeys', action: 'create' },
  'apikeys:read': { resource: 'apikeys', action: 'read' },
  'apikeys:delete': { resource: 'apikeys', action: 'delete' },

  // Secret permissions
  'secrets:create': { resource: 'secrets', action: 'create' },
  'secrets:read': { resource: 'secrets', action: 'read' },
  'secrets:update': { resource: 'secrets', action: 'update' },
  'secrets:delete': { resource: 'secrets', action: 'delete' },
} as const;

export type PermissionName = keyof typeof RBAC_PERMISSIONS;

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionName[]> = {
  admin: Object.keys(RBAC_PERMISSIONS) as PermissionName[],
  operator: [
    'servers:create', 'servers:read', 'servers:update', 'servers:execute',
    'namespaces:create', 'namespaces:read', 'namespaces:update',
    'endpoints:create', 'endpoints:read', 'endpoints:update',
    'apikeys:create', 'apikeys:read', 'apikeys:delete',
    'secrets:create', 'secrets:read', 'secrets:update',
    'audit:read',
  ],
  user: [
    'servers:read', 'servers:execute',
    'namespaces:read',
    'endpoints:read',
    'apikeys:create', 'apikeys:read', 'apikeys:delete',
    'secrets:read',
  ],
  viewer: [
    'servers:read',
    'namespaces:read',
    'endpoints:read',
  ],
};
