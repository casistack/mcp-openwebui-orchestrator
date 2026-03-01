import { createDatabase } from '../adapters';
import { roles, permissions, rolePermissions } from '../schema';
import { RBAC_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '@mcp-platform/shared';
import { randomUUID } from 'crypto';

export async function seed() {
  const db = createDatabase();

  console.log('Seeding database...');

  // Create default roles
  const roleRecords: Record<string, string> = {};
  const defaultRoles = [
    { name: 'admin', description: 'Full system access', isSystem: true },
    { name: 'operator', description: 'Manage servers and namespaces', isSystem: true },
    { name: 'user', description: 'Use servers and manage own API keys', isSystem: true },
    { name: 'viewer', description: 'Read-only access', isSystem: true },
  ];

  for (const role of defaultRoles) {
    const id = randomUUID().replace(/-/g, '');
    roleRecords[role.name] = id;
    db.insert(roles).values({ id, ...role }).onConflictDoNothing().run();
  }

  console.log(`Created ${defaultRoles.length} default roles`);

  // Create permissions
  const permRecords: Record<string, string> = {};
  for (const [name, { resource, action }] of Object.entries(RBAC_PERMISSIONS)) {
    const id = randomUUID().replace(/-/g, '');
    permRecords[name] = id;
    db.insert(permissions)
      .values({ id, name, resource, action, description: `${action} ${resource}` })
      .onConflictDoNothing()
      .run();
  }

  console.log(`Created ${Object.keys(RBAC_PERMISSIONS).length} permissions`);

  // Assign permissions to roles
  let assignmentCount = 0;
  for (const [roleName, permNames] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const roleId = roleRecords[roleName];
    if (!roleId) continue;

    for (const permName of permNames) {
      const permId = permRecords[permName];
      if (!permId) continue;

      db.insert(rolePermissions)
        .values({ roleId, permissionId: permId })
        .onConflictDoNothing()
        .run();
      assignmentCount++;
    }
  }

  console.log(`Created ${assignmentCount} role-permission assignments`);
  console.log('Seed complete.');
}

// Run directly with: tsx src/seed/index.ts
if (require.main === module) {
  seed().catch(console.error);
}
