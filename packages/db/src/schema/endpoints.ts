import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { namespaces } from './namespaces';
import { users } from './users';

export const endpoints = sqliteTable('endpoints', {
  id: text('id').primaryKey(),
  namespaceId: text('namespace_id').notNull().references(() => namespaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  transport: text('transport').notNull(), // 'sse' | 'streamable-http' | 'openapi'
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  authType: text('auth_type').default('api_key'), // 'none' | 'api_key' | 'oauth' | 'bearer'
  oauthConfig: text('oauth_config', { mode: 'json' }).$type<Record<string, unknown>>(),
  rateLimit: integer('rate_limit').default(100),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('endpoint_namespace_slug').on(table.namespaceId, table.slug),
]);
