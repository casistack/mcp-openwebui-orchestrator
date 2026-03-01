import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { users } from './users';
import { mcpServers } from './servers';

export const namespaces = sqliteTable('namespaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  isPublic: integer('is_public', { mode: 'boolean' }).default(false),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const namespaceServers = sqliteTable('namespace_servers', {
  namespaceId: text('namespace_id').notNull().references(() => namespaces.id, { onDelete: 'cascade' }),
  serverId: text('server_id').notNull().references(() => mcpServers.id, { onDelete: 'cascade' }),
  addedAt: integer('added_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  primaryKey({ columns: [table.namespaceId, table.serverId] }),
]);
