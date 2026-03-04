import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { mcpServers } from './servers';

export const configSources = sqliteTable('config_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'file' | 'url' | 'manual'
  location: text('location'), // file path or URL, null for manual
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  priority: integer('priority').default(0),
  autoSync: integer('auto_sync', { mode: 'boolean' }).default(false),
  syncIntervalMinutes: integer('sync_interval_minutes').default(60),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  lastSyncStatus: text('last_sync_status'), // 'success' | 'error' | null
  lastSyncError: text('last_sync_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const sourceServers = sqliteTable('source_servers', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => configSources.id, { onDelete: 'cascade' }),
  serverKey: text('server_key').notNull(),
  serverName: text('server_name').notNull(),
  serverConfig: text('server_config').notNull(), // JSON string of full server config
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  importedServerId: text('imported_server_id').references(() => mcpServers.id, { onDelete: 'set null' }),
  status: text('status').default('pending'), // 'pending' | 'active' | 'removed'
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('source_server_unique').on(table.sourceId, table.serverKey),
]);
