import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../schema';

export type DatabaseType = 'sqlite' | 'postgres' | 'mysql';

export interface DatabaseConfig {
  type: DatabaseType;
  url: string;
}

export type AppDatabase = ReturnType<typeof createSqliteDatabase>;

function createSqliteDatabase(url: string) {
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzleSqlite(sqlite, { schema });
}

export function createDatabase(config?: DatabaseConfig): AppDatabase {
  const type = config?.type ?? (process.env.DATABASE_TYPE as DatabaseType) ?? 'sqlite';
  const url = config?.url ?? process.env.DATABASE_URL ?? 'mcp-platform.db';

  switch (type) {
    case 'sqlite':
      return createSqliteDatabase(url);

    case 'postgres':
      // PostgreSQL support - install pg package
      // import { drizzle } from 'drizzle-orm/node-postgres';
      // import { Pool } from 'pg';
      // return drizzle(new Pool({ connectionString: url }), { schema });
      throw new Error(
        'PostgreSQL support requires the "pg" package. Install it with: pnpm add pg @types/pg'
      );

    case 'mysql':
      // MySQL support - install mysql2 package
      // import { drizzle } from 'drizzle-orm/mysql2';
      // import mysql from 'mysql2/promise';
      // return drizzle(await mysql.createPool(url), { schema });
      throw new Error(
        'MySQL support requires the "mysql2" package. Install it with: pnpm add mysql2'
      );

    default:
      throw new Error(`Unsupported database type: ${type}. Use 'sqlite', 'postgres', or 'mysql'.`);
  }
}
