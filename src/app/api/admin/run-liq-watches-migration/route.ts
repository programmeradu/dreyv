import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 7C.5 — One-shot migration: create `liquidation_watches`.
 * Inline SQL (drizzle/ is read-only). Protected by MIGRATION_TOKEN query param.
 *
 * Usage: POST /api/admin/run-liq-watches-migration?token=<MIGRATION_TOKEN>
 * Default token: "liqwatch-2026-04-27".
 *
 * DELETE this route after applying.
 */
const MIGRATION_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "liquidation_watches" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "venue" text NOT NULL,
    "position_account" text,
    "health_factor_floor" numeric NOT NULL DEFAULT '1.25',
    "auto_deleverage" boolean NOT NULL DEFAULT false,
    "alert_webhook" text,
    "enabled" boolean NOT NULL DEFAULT true,
    "status" text NOT NULL DEFAULT 'active',
    "last_health_factor" numeric,
    "last_checked_at" timestamp,
    "last_check_error" text,
    "last_breached_at" timestamp,
    "check_attempts" integer NOT NULL DEFAULT 0,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "liq_watches_wallet_idx" ON "liquidation_watches" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "liq_watches_enabled_idx" ON "liquidation_watches" ("enabled")`,
  `CREATE INDEX IF NOT EXISTS "liq_watches_status_idx" ON "liquidation_watches" ("status")`,
];

export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'liqwatch-2026-04-27';
  if (token !== expected) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const sql = neon(url);
    const results: Array<{ stmt: string; ok: boolean; error?: string }> = [];
    for (const stmt of MIGRATION_SQL) {
      try {
        await sql.query(stmt);
        results.push({ stmt: stmt.slice(0, 80).replace(/\s+/g, ' '), ok: true });
      } catch (err) {
        results.push({
          stmt: stmt.slice(0, 80).replace(/\s+/g, ' '),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const tbl = await sql.query(`SELECT to_regclass('public.liquidation_watches') AS exists`);
    return NextResponse.json({
      success: true,
      tableExists: tbl[0]?.exists ?? null,
      results,
      reminder: 'DELETE this route file now: src/app/api/admin/run-liq-watches-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
