export * from './schema';
export { createDatabase, type AppDatabase, type DatabaseType, type DatabaseConfig } from './adapters';

// Re-export drizzle-orm utilities so consumers don't need a separate drizzle-orm dependency
export { eq, desc, and, gte, sql, count, or, lt, lte, gt, ne, isNull, isNotNull, asc, inArray } from 'drizzle-orm';
