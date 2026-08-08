/**
 * /api/treasury/pnl-daily?wallet=…&range=7d|30d|90d
 *
 * Returns one row per day with inflow/outflow/yield/fee USD bucketed.
 * Reads from `mv_vault_pnl_daily` for O(1) lookups; if the MV doesn't exist
 * yet (first deploy of Block B Step 3), self-heals by creating it on the
 * fly and then falls back to a raw aggregation query for this single
 * response so the user never sees an empty chart.
 *
 * This is what the /app/analytics PnL waterfall reads.
 */
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const MV_DDL = [
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
];

let ensureRan = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureMv(sql: any) {
  if (ensureRan) return;
  for (const stmt of MV_DDL) {
    try {
      await sql.query(stmt);
    } catch {
      /* idempotent — ignore */
    }
  }
  ensureRan = true;
}

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const range = url.searchParams.get("range") ?? "30d";
  if (!wallet) return NextResponse.json({ ok: true, days: [] });

  const dbUrl = process.env.DATABASE_URL?.replace(/['"\r\n]/g, "").trim();
  if (!dbUrl) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });

  const days = RANGE_DAYS[range] ?? 30;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = neon(dbUrl);
  await ensureMv(sql);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let rows: any[] = [];
  try {
    rows = (await sql`
      SELECT
        day::text AS day,
        inflow_usd::float8  AS inflow_usd,
        outflow_usd::float8 AS outflow_usd,
        yield_usd::float8   AS yield_usd,
        fee_usd::float8     AS fee_usd,
        net_usd::float8     AS net_usd,
        event_count::int    AS event_count
      FROM mv_vault_pnl_daily
      WHERE wallet_address = ${wallet}
        AND day >= ${since}::date
      ORDER BY day ASC
    `) as any[];
  } catch {
    // Fallback to raw aggregation if MV still unavailable.
    rows = (await sql`
      SELECT
        date_trunc('day', occurred_at)::date::text AS day,
        COALESCE(SUM(CASE WHEN kind='inflow'  THEN amount_usd END),0)::float8 AS inflow_usd,
        COALESCE(SUM(CASE WHEN kind='outflow' THEN amount_usd END),0)::float8 AS outflow_usd,
        COALESCE(SUM(CASE WHEN kind='yield'   THEN amount_usd END),0)::float8 AS yield_usd,
        COALESCE(SUM(CASE WHEN kind='fee'     THEN amount_usd END),0)::float8 AS fee_usd,
        COALESCE(SUM(amount_usd),0)::float8 AS net_usd,
        COUNT(*)::int AS event_count
      FROM treasury_events
      WHERE wallet_address = ${wallet}
        AND occurred_at >= ${since}::date
      GROUP BY 1
      ORDER BY 1 ASC
    `) as any[];
  }

  return NextResponse.json({ ok: true, range, days: rows });
}
