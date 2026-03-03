import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  displayName: text('display_name'),
  description: text('description'),
  transport: text('transport').notNull(), // 'stdio' | 'sse' | 'streamable-http'
  // STDIO config
  command: text('command'),
  args: text('args', { mode: 'json' }).$type<string[]>(),
  cwd: text('cwd'),
  // URL-based config
  url: text('url'),
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),
  // Proxy settings
  proxyType: text('proxy_type').default('mcpo'),
  needsProxy: integer('needs_proxy', { mode: 'boolean' }).default(true),
  // Resource limits
  cpuLimit: text('cpu_limit'),
  memoryLimit: text('memory_limit'),
  networkPolicy: text('network_policy').default('default'),
  // Status
  status: text('status').default('inactive'),
  isPublic: integer('is_public', { mode: 'boolean' }).default(false),
  // Runtime state (managed by ServerRuntimeService)
  runtimeStatus: text('runtime_status').default('stopped'),
  runtimePid: integer('runtime_pid'),
  runtimePort: integer('runtime_port'),
  runtimeProxyTypeUsed: text('runtime_proxy_type_used'),
  runtimeStartedAt: integer('runtime_started_at', { mode: 'timestamp' }),
  runtimeRestartCount: integer('runtime_restart_count').default(0),
  runtimeLastError: text('runtime_last_error'),
  runtimeMode: text('runtime_mode').default('individual'),
  // Ownership
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const serverRuntimeLogs = sqliteTable('server_runtime_logs', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => mcpServers.id, { onDelete: 'cascade' }),
  stream: text('stream').notNull().default('stdout'),
  message: text('message').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const serverEnvVars = sqliteTable('server_env_vars', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => mcpServers.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(), // AES-256-GCM encrypted
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  isSecret: integer('is_secret', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('server_env_unique').on(table.serverId, table.key),
]);
