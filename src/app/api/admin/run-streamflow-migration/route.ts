import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 7B.1 — One-shot migration: create `streamflow_streams` table.
 * Inline SQL (drizzle/ is read-only). Protected by MIGRATION_TOKEN query param.
 *
 * Usage: POST /api/admin/run-streamflow-migration?token=<MIGRATION_TOKEN>
 * Default token: "streamflow-2026-04-27".
 *
 * DELETE this route after applying.
 */
const MIGRATION_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "streamflow_streams" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "stream_id" text NOT NULL UNIQUE,
    "command_id" text,
    "wallet_address" text NOT NULL,
    "recipient" text NOT NULL,
    "mint" text NOT NULL,
    "token_symbol" text NOT NULL,
    "amount_per_period" numeric NOT NULL,
    "period_seconds" integer NOT NULL,
    "duration_periods" integer NOT NULL,
    "total_amount" numeric NOT NULL,
    "cliff_seconds" integer NOT NULL DEFAULT 0,
    "cancellable" boolean NOT NULL DEFAULT true,
    "start_ts" integer NOT NULL,
    "status" text NOT NULL DEFAULT 'pending_signature',
    "signature" text,
    "reconciled_at" timestamp,
    "reconcile_attempts" integer NOT NULL DEFAULT 0,
    "last_reconcile_error" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "streamflow_streams_wallet_idx" ON "streamflow_streams" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "streamflow_streams_status_idx" ON "streamflow_streams" ("status")`,
  `CREATE INDEX IF NOT EXISTS "streamflow_streams_created_idx" ON "streamflow_streams" ("created_at")`,
];

export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  }
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'streamflow-2026-04-27';
  if (token !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
    const check = await sql.query(`SELECT to_regclass('public.streamflow_streams') AS exists`);
    return NextResponse.json({
      success: true,
      tableExists: check[0]?.exists ?? null,
      results,
      reminder: 'DELETE this route file now: src/app/api/admin/run-streamflow-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
