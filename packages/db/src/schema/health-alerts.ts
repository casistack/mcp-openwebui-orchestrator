import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { mcpServers } from './servers';

export const healthAlerts = sqliteTable('health_alerts', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => mcpServers.id, { onDelete: 'cascade' }),
  alertType: text('alert_type').notNull(), // 'consecutive_failures' | 'high_failure_rate' | 'slow_response' | 'auth_error' | 'resource_exhaustion' | 'process_crashed'
  severity: text('severity').notNull(), // 'low' | 'medium' | 'high' | 'critical'
  message: text('message').notNull(),
  details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
  remediation: text('remediation'), // Action taken: 'restarted' | 'skipped' | null
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
