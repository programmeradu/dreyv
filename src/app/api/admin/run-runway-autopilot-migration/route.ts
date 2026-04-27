import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 7D.2 — One-shot migration: create `runway_autopilot_rules`.
 * DELETE this route after applying.
 *
 * Usage: POST /api/admin/run-runway-autopilot-migration?token=runway-2026-04-27
 */
const MIGRATION_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "runway_autopilot_rules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "target_runway_months" numeric NOT NULL,
    "monthly_burn_usd" numeric,
    "inferred_burn_usd" numeric,
    "rebalance_mode" text NOT NULL DEFAULT 'balanced',
    "actions_allowed" jsonb NOT NULL DEFAULT '["alert_only"]',
    "alert_webhook" text,
    "enabled" boolean NOT NULL DEFAULT true,
    "status" text NOT NULL DEFAULT 'active',
    "last_treasury_usd" numeric,
    "last_runway_months" numeric,
    "last_checked_at" timestamp,
    "last_check_error" text,
    "last_breached_at" timestamp,
    "check_attempts" integer NOT NULL DEFAULT 0,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "runway_autopilot_wallet_idx" ON "runway_autopilot_rules" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "runway_autopilot_enabled_idx" ON "runway_autopilot_rules" ("enabled")`,
  `CREATE INDEX IF NOT EXISTS "runway_autopilot_status_idx" ON "runway_autopilot_rules" ("status")`,
];

export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'runway-2026-04-27';
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
    const tbl = await sql.query(`SELECT to_regclass('public.runway_autopilot_rules') AS exists`);
    return NextResponse.json({
      success: true,
      tableExists: tbl[0]?.exists ?? null,
      results,
      reminder: 'DELETE this route file: src/app/api/admin/run-runway-autopilot-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
