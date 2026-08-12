import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/db/schema';

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const FALLBACK_URL = 'postgresql://unconfigured:unconfigured@ep-dummy.neon.tech/neondb';

let _cachedDb: DrizzleDb | null = null;
let _cachedUrl: string | null = null;

/**
 * Clean connection URL for Neon HTTP serverless driver.
 * Strips TCP-only PostgreSQL parameters (e.g. channel_binding=require) that cause
 * query failures when executed over Neon HTTPS fetch proxy.
 */
function sanitizeNeonHttpUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  const clean = rawUrl.replace(/['"\r\n]/g, '').trim();
  try {
    const u = new URL(clean);
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch {
    return clean.replace(/[?&]channel_binding=[^&]*/g, '').replace(/[?&]$/, '');
  }
}

/**
 * Creates or retrieves the cached Drizzle ORM instance for Neon Postgres.
 * Dynamically resolves process.env.DATABASE_URL and inspects incoming x-dreyv-database-url request headers.
 * Always returns a valid Drizzle client with `.select()`, `.insert()`, `.update()`, and `.query`.
 */
export function getDb(): DrizzleDb {
  let envUrl = sanitizeNeonHttpUrl(process.env.DATABASE_URL || '');

  // Hydrate from request headers if unconfigured in Node.js isolate context
  if (!envUrl && typeof window === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { headers } = require('next/headers');
      const h = headers();
      // Next.js 15 returns a Promise for headers(). We cannot await it here synchronously.
      // If it's a Promise, we skip reading from headers to prevent DynamicServerError crashes.
      if (h && typeof h.then !== 'function') {
        const headerUrl = typeof h.get === 'function' ? h.get('x-dreyv-database-url') : null;
        if (headerUrl) {
          envUrl = sanitizeNeonHttpUrl(headerUrl);
          process.env.DATABASE_URL = envUrl;
        }
      }
    } catch {
      // Ignore if headers() is called outside request context (e.g. background scripts)
    }
  }

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
  const sanitizedUrl = sanitizeNeonHttpUrl(branchConnectionUrl);
  const sql = neon(sanitizedUrl);
  return drizzle(sql, { schema });
}