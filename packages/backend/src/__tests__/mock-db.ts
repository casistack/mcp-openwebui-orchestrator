import { jest } from '@jest/globals';

/**
 * In-memory mock database for testing services.
 *
 * Simulates the drizzle-orm API surface used by our services:
 *   db.select().from(table)           -> returns rows for that table
 *   db.insert(table).values(row)      -> inserts a row
 *   db.run(sql, ...params)            -> raw SQL (update/delete)
 */

// Table sentinel objects matching what @mcp-platform/db exports
export const mockTables = {
  mcpServers: { __table: 'mcp_servers' },
  serverEnvVars: { __table: 'server_env_vars' },
  namespaces: { __table: 'namespaces' },
  namespaceServers: { __table: 'namespace_servers' },
  endpoints: { __table: 'endpoints' },
  toolConfigs: { __table: 'tool_configs' },
  apiKeys: { __table: 'api_keys' },
  roles: { __table: 'roles' },
  permissions: { __table: 'permissions' },
  rolePermissions: { __table: 'role_permissions' },
  users: { __table: 'users' },
  auditLogs: { __table: 'audit_logs' },
};

type TableRef = { __table: string };

export interface MockDatabase {
  select: () => { from: (table: TableRef) => Promise<unknown[]> };
  insert: (table: TableRef) => { values: (row: unknown) => Promise<void> };
  run: jest.Mock<(...args: unknown[]) => void>;
  // Test helpers
  _getTable: (name: string) => unknown[];
  _setTable: (name: string, rows: unknown[]) => void;
  _addRow: (name: string, row: unknown) => void;
  _clear: () => void;
}

export function createMockDatabase(): MockDatabase {
  const tables = new Map<string, unknown[]>();

  const getTableName = (table: TableRef): string => table.__table ?? 'unknown';

  const db: MockDatabase = {
    _getTable: (name: string) => tables.get(name) ?? [],
    _setTable: (name: string, rows: unknown[]) => tables.set(name, rows),
    _addRow: (name: string, row: unknown) => {
      if (!tables.has(name)) tables.set(name, []);
      tables.get(name)!.push(row);
    },
    _clear: () => tables.clear(),

    select: () => ({
      from: (table: TableRef) => {
        const name = getTableName(table);
        return Promise.resolve([...(tables.get(name) ?? [])]);
      },
    }),

    insert: (table: TableRef) => ({
      values: (row: unknown) => {
        const name = getTableName(table);
        if (!tables.has(name)) tables.set(name, []);
        tables.get(name)!.push({ ...(row as object) });
        return Promise.resolve();
      },
    }),

    run: jest.fn(),
  };

  return db;
}
