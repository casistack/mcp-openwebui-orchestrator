import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { namespaces } from './namespaces';
import { mcpServers } from './servers';

export const toolConfigs = sqliteTable('tool_configs', {
  id: text('id').primaryKey(),
  namespaceId: text('namespace_id').notNull().references(() => namespaces.id, { onDelete: 'cascade' }),
  serverId: text('server_id').notNull().references(() => mcpServers.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  displayName: text('display_name'),
  description: text('description'),
  annotations: text('annotations', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('tool_config_unique').on(table.namespaceId, table.serverId, table.toolName),
]);
