import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  resourceId: text('resource_id'),
  details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  status: text('status').default('success'), // 'success' | 'failure' | 'denied'
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  index('idx_audit_user').on(table.userId, table.createdAt),
  index('idx_audit_resource').on(table.resource, table.resourceId, table.createdAt),
  index('idx_audit_action').on(table.action, table.createdAt),
  index('idx_audit_created').on(table.createdAt),
]);
