import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { namespaces } from './namespaces';

export const pipelineSteps = sqliteTable('pipeline_steps', {
  id: text('id').primaryKey(),
  namespaceId: text('namespace_id').notNull().references(() => namespaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(), // request-logger | tool-call-logger | rate-limiter | content-filter | request-transform | response-transform | header-injector
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  order: integer('order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
