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
  healthRecords: { __table: 'health_records' },
  serverRuntimeLogs: { __table: 'server_runtime_logs' },
  marketplaceListings: { __table: 'marketplace_listings', [Symbol.for('drizzle:Name')]: 'marketplace_listings' },
  marketplaceReviews: { __table: 'marketplace_reviews', [Symbol.for('drizzle:Name')]: 'marketplace_reviews' },
  marketplaceInstalls: { __table: 'marketplace_installs', [Symbol.for('drizzle:Name')]: 'marketplace_installs' },
  pipelineSteps: { __table: 'pipeline_steps' },
  userToolPermissions: { __table: 'user_tool_permissions' },
  userEndpointTokens: { __table: 'user_endpoint_tokens' },
  eq: (...args: unknown[]) => args,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  desc: (...args: unknown[]) => args,
  and: (...args: unknown[]) => args,
  gte: (...args: unknown[]) => args,
  count: (...args: unknown[]) => args,
};

type TableRef = { __table: string };

export interface MockDatabase {
  select: () => { from: (table: TableRef) => Promise<unknown[]> };
  insert: (table: TableRef) => { values: (row: unknown) => { run: () => void } & Promise<void> };
  update: (table: TableRef) => { set: (data: unknown) => { where: (cond: unknown) => { run: () => void } } };
  delete: (table: TableRef) => { where: (cond: unknown) => Promise<{ changes: number }> };
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
        const p = Promise.resolve() as Promise<void> & { run: () => void };
        p.run = () => {};
        return p;
      },
    }),

    update: (_table: TableRef) => ({
      set: (_data: unknown) => ({
        where: (_cond: unknown) => ({
          run: () => {},
        }),
      }),
    }),

    delete: (_table: TableRef) => ({
      where: (_cond: unknown) => Promise.resolve({ changes: 1 }),
    }),

    run: jest.fn(),
  };

  return db;
}
