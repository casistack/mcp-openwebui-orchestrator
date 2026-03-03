import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';
import { endpoints } from './endpoints';

export const userEndpointTokens = sqliteTable('user_endpoint_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpointId: text('endpoint_id').notNull().references(() => endpoints.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'google' | 'github' | 'custom'
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  scopes: text('scopes'), // comma-separated scopes
  tokenType: text('token_type').default('bearer'), // 'bearer' | 'basic'
  status: text('status').default('active'), // 'active' | 'expired' | 'revoked' | 'refresh_failed'
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  lastRefreshedAt: integer('last_refreshed_at', { mode: 'timestamp' }),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('user_endpoint_provider').on(table.userId, table.endpointId, table.provider),
]);
