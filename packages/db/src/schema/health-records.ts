import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { mcpServers } from './servers';

export const healthRecords = sqliteTable('health_records', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => mcpServers.id, { onDelete: 'cascade' }),
  healthy: integer('healthy', { mode: 'boolean' }).notNull(),
  responseTime: integer('response_time'),
  statusCode: integer('status_code'),
  error: text('error'),
  endpoint: text('endpoint'),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  index('idx_health_server').on(table.serverId, table.checkedAt),
]);
