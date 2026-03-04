import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const runtimeConfig = sqliteTable('runtime_config', {
  id: text('id').primaryKey(),
  mode: text('mode').notNull().default('individual'), // 'individual' | 'unified' | 'multi-transport'
  unifiedPort: integer('unified_port'),
  enabledTransports: text('enabled_transports'), // JSON: { sse: bool, websocket: bool, streamableHttp: bool }
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
