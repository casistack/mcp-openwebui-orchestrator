import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDatabase } from './adapters';
import path from 'path';

const db = createDatabase();

console.log('Running migrations...');
migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
console.log('Migrations complete.');
