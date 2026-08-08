export const runtime = "edge";
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

/**
 * Admin endpoint to apply the Phase 14 / Block B Step 3 treasury
 * materialized views (`migrations/sql/0021_treasury_materialized_views.sql`).
 *
 * Idempotent — every statement uses IF NOT EXISTS / OR REPLACE except the
 * initial REFRESH calls, which are safe to re-run.
 *
 * Auth: must send `x-admin-key: ${process.env.JWT_SECRET}` (reusing an
 * already-managed secret rather than introducing a new one). Returns 401
 * otherwise. POST only.
 */
export const dynamic = "force-dynamic";

const STATEMENTS: string[] = [
  `CREATE MATERIALIZED VIEW IF NOT EXISTS mv_vault_pnl_daily AS
   SELECT
     wallet_address,
     date_trunc('day', occurred_at)::date AS day,
     COALESCE(SUM(CASE WHEN kind = 'inflow'  THEN amount_usd END), 0) AS inflow_usd,
     COALESCE(SUM(CASE WHEN kind = 'outflow' THEN amount_usd END), 0) AS outflow_usd,
     COALESCE(SUM(CASE WHEN kind = 'yield'   THEN amount_usd END), 0) AS yield_usd,
     COALESCE(SUM(CASE WHEN kind = 'fee'     THEN amount_usd END), 0) AS fee_usd,
     COALESCE(SUM(amount_usd), 0)                                     AS net_usd,
     COUNT(*)                                                         AS event_count
   FROM treasury_events
   GROUP BY wallet_address, date_trunc('day', occurred_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mv_vault_pnl_daily_pk
     ON mv_vault_pnl_daily (wallet_address, day)`,
  `CREATE INDEX IF NOT EXISTS mv_vault_pnl_daily_day_idx
     ON mv_vault_pnl_daily (day DESC)`,
  `CREATE MATERIALIZED VIEW IF NOT EXISTS mv_vault_composition_daily AS
   WITH latest_per_day AS (
     SELECT DISTINCT ON (wallet_address, date_trunc('day', captured_at))
       wallet_address,
       date_trunc('day', captured_at)::date AS day,
       captured_at,
       composition,
       total_usd
     FROM treasury_snapshots
     ORDER BY wallet_address, date_trunc('day', captured_at), captured_at DESC
   )
   SELECT
     l.wallet_address,
     l.day,
     COALESCE(elem->>'symbol', 'UNKNOWN')          AS symbol,
     COALESCE((elem->>'amount')::numeric, 0)       AS amount,
     COALESCE((elem->>'priceUsd')::numeric, 0)     AS price_usd,
     COALESCE((elem->>'valueUsd')::numeric, 0)     AS value_usd,
     COALESCE((elem->>'isStable')::boolean, false) AS is_stable,
     l.total_usd                                   AS day_total_usd
   FROM latest_per_day l,
        LATERAL jsonb_array_elements(l.composition) AS elem
   WHERE jsonb_typeof(l.composition) = 'array'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mv_vault_composition_daily_pk
     ON mv_vault_composition_daily (wallet_address, day, symbol)`,
  `CREATE INDEX IF NOT EXISTS mv_vault_composition_daily_day_idx
     ON mv_vault_composition_daily (day DESC)`,
  `REFRESH MATERIALIZED VIEW mv_vault_pnl_daily`,
  `REFRESH MATERIALIZED VIEW mv_vault_composition_daily`,
];

export async function POST(req: Request) {
  const key = req.headers.get("x-admin-key");
  const expected = process.env.JWT_SECRET;
  if (!expected || key !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, "").trim();
  if (!url) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 500 },
    );
  }

  const sql = neon(url);
  const applied: string[] = [];
  const errors: { statement: string; message: string }[] = [];

  for (const stmt of STATEMENTS) {
    try {
      // neon-http supports raw SQL via the tagged template; use .query for plain string.
      // The serverless driver exposes the underlying executor as a callable.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sql as any).query(stmt);
      applied.push(stmt.split("\n")[0].slice(0, 80));
    } catch (err) {
      errors.push({
        statement: stmt.split("\n")[0].slice(0, 80),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    applied,
    errors,
  });
}
