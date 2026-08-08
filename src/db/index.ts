import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/db/schema';

type DrizzleSchemaDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Neon Postgres connection via HTTP (serverless-friendly).
 * Dynamic getter prevents module-scope null locking if process.env.DATABASE_URL
 * is set or refreshed after container process initialization.
 */
let _cachedDb: DrizzleSchemaDb | null = null;
let _cachedUrl: string | null = null;

export function getDb(): DrizzleSchemaDb | null {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) {
    return null;
  }
  if (_cachedDb && _cachedUrl === url) {
    return _cachedDb;
  }
  _cachedUrl = url;
  const sql = neon(url);
  _cachedDb = drizzle(sql, { schema });
  return _cachedDb;
}

/**
 * Dynamic Proxy wrapper for `db`.
 * Allows `import { db } from "@/db"` to work transparently while dynamically
 * evaluating process.env.DATABASE_URL on every query access with full schema typing.
 */
export const db: DrizzleSchemaDb = new Proxy({} as any, {
  get(_target, prop) {
    const instance = getDb();
    if (!instance) {
      return undefined;
    }
    const val = Reflect.get(instance, prop, instance);
    return typeof val === 'function' ? val.bind(instance) : val;
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