import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { users } from './users';
import { namespaces } from './namespaces';
import { endpoints } from './endpoints';

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(),
  scope: text('scope').default('user'), // 'user' | 'namespace' | 'endpoint'
  namespaceId: text('namespace_id').references(() => namespaces.id, { onDelete: 'set null' }),
  endpointId: text('endpoint_id').references(() => endpoints.id, { onDelete: 'set null' }),
  rateLimit: integer('rate_limit').default(100),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
