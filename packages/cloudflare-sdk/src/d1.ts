/**
 * Cloudflare D1 (serverless SQLite) REST wrapper.
 * Docs: https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/
 */

import { resolveConfig, authHeaders, cfFetch, accountUrl, type CFConfig } from "./_internal";

export interface D1Target {
  databaseId: string;
  config?: Partial<CFConfig>;
}

export interface D1QueryOptions extends D1Target {
  sql: string;
  params?: unknown[];
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: {
    duration?: number;
    rows_read?: number;
    rows_written?: number;
    last_row_id?: number | null;
  };
  success: boolean;
}

function d1Url(cfg: CFConfig, databaseId: string, path: string) {
  return accountUrl(cfg, `/d1/database/${databaseId}${path}`);
}

/** Execute a single statement (read or write) and return rows + meta. */
export async function query<T = Record<string, unknown>>(
  opts: D1QueryOptions
): Promise<D1Result<T>> {
  const cfg = resolveConfig(opts.config);
  const res = await cfFetch<any>(d1Url(cfg, opts.databaseId, "/query"), {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify({ sql: opts.sql, params: opts.params ?? [] }),
  });
  const first = Array.isArray(res?.result) ? res.result[0] : res?.result;
  return {
    results: first?.results ?? [],
    meta: first?.meta ?? {},
    success: !!res?.success,
  };
}

/** Alias for write-style statements where you don't care about returned rows. */
export async function exec(opts: D1QueryOptions): Promise<D1Result<never>> {
  return query<never>(opts);
}

export interface D1BatchOptions extends D1Target {
  statements: Array<{ sql: string; params?: unknown[] }>;
}

/** Run multiple statements atomically. */
export async function batch(opts: D1BatchOptions): Promise<D1Result[]> {
  const cfg = resolveConfig(opts.config);
  const res = await cfFetch<any>(d1Url(cfg, opts.databaseId, "/query"), {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(opts.statements),
  });
  return (res?.result ?? []).map((r: any) => ({
    results: r?.results ?? [],
    meta: r?.meta ?? {},
    success: !!r?.success,
  }));
}

export const d1 = { query, exec, batch };
