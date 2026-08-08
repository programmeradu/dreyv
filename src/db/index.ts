import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/db/schema';

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  drizzleDb?: DrizzleDb;
};

/**
 * Creates or retrieves the cached Drizzle ORM instance for Neon Postgres.
 */
export function getDb(): DrizzleDb {
  if (globalForDb.drizzleDb) {
    return globalForDb.drizzleDb;
  }

  const url = (process.env.DATABASE_URL || '').replace(/['"\r\n]/g, '').trim();
  if (!url) {
    // If DATABASE_URL is unconfigured at cold start, use fallback client so imports don't crash
    const dummySql = neon('postgresql://unconfigured:unconfigured@ep-dummy.neon.tech/neondb');
    return drizzle(dummySql, { schema });
  }

  const sql = neon(url);
  const instance = drizzle(sql, { schema });
  globalForDb.drizzleDb = instance;
  return instance;
}

/**
 * Primary database export — standard Drizzle instance (no Proxy collisions).
 */
export const db: DrizzleDb = getDb();
export type Database = typeof db;

/**
 * Create a Drizzle client pointed at a Neon branch.
 * Used for AI sandbox isolation — ephemeral database clones.
 */
export function createBranchDb(branchConnectionUrl: string) {
  const sql = neon(branchConnectionUrl);
  return drizzle(sql, { schema });
}