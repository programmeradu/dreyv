import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/db/schema';

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const FALLBACK_URL = 'postgresql://unconfigured:unconfigured@ep-dummy.neon.tech/neondb';

let _cachedDb: DrizzleDb | null = null;
let _cachedUrl: string | null = null;

/**
 * Creates or retrieves the cached Drizzle ORM instance for Neon Postgres.
 * Always returns a valid Drizzle client with `.select()`, `.insert()`, `.update()`, and `.query`.
 */
export function getDb(): DrizzleDb {
  const envUrl = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  const url = envUrl || FALLBACK_URL;

  if (_cachedDb && _cachedUrl === url) {
    return _cachedDb;
  }

  const sql = neon(url);
  _cachedDb = drizzle(sql, { schema });
  _cachedUrl = url;
  return _cachedDb;
}

/**
 * Primary database export — dynamic Proxy wrapping a function target.
 * Resolves process.env.DATABASE_URL dynamically per query while remaining 100%
 * compatible with Webpack bundling, `.select()`, `.insert()`, and `.query`.
 */
export const db: DrizzleDb = new Proxy(function () {} as any, {
  get(_target, prop) {
    const realDb = getDb();
    const val = (realDb as any)[prop];
    return typeof val === 'function' ? val.bind(realDb) : val;
  },
});

export type Database = typeof db;

/**
 * Create a Drizzle client pointed at a Neon branch.
 * Used for AI sandbox isolation — ephemeral database clones.
 */
export function createBranchDb(branchConnectionUrl: string) {
  const sql = neon(branchConnectionUrl);
  return drizzle(sql, { schema });
}