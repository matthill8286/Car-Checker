import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_DIR, type Database } from '../src/db/client.js';
import { schema } from '../src/db/schema.js';

/** A real Postgres (PGlite, in process) with the app's migrations applied. */
export async function testDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Database, close: () => client.close() };
}
