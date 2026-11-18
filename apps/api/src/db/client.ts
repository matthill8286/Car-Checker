import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { schema } from './schema.js';

/** Any Drizzle Postgres database: node-postgres in production, PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function connect(
  url: string,
  options: { migrate: boolean },
): Promise<{ db: Database; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  if (options.migrate) await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => pool.end() };
}
