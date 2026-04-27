import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 7B.3 — One-shot migration: create `gas_tank_rules` + `gas_tank_refills`.
 * Inline SQL (drizzle/ is read-only). Protected by MIGRATION_TOKEN query param.
 *
 * Usage: POST /api/admin/run-gas-tank-migration?token=<MIGRATION_TOKEN>
 * Default token: "gastank-2026-04-27".
 *
 * DELETE this route after applying.
 */
const MIGRATION_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "gas_tank_rules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "floor_sol" numeric NOT NULL,
    "target_sol" numeric NOT NULL,
    "funding_token" text NOT NULL DEFAULT 'USDC',
    "funding_mint" text NOT NULL,
    "max_refills_per_day" integer NOT NULL DEFAULT 3,
    "slippage_bps" integer NOT NULL DEFAULT 50,
    "enabled" boolean NOT NULL DEFAULT true,
    "last_triggered_at" timestamp,
    "last_balance_sol" numeric,
    "last_checked_at" timestamp,
    "refill_day_bucket" text,
    "refills_today" integer NOT NULL DEFAULT 0,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "gas_tank_rules_wallet_idx" ON "gas_tank_rules" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "gas_tank_rules_enabled_idx" ON "gas_tank_rules" ("enabled")`,
  `CREATE TABLE IF NOT EXISTS "gas_tank_refills" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "rule_id" uuid NOT NULL REFERENCES "gas_tank_rules"("id") ON DELETE CASCADE,
    "wallet_address" text NOT NULL,
    "trigger_balance_sol" numeric NOT NULL,
    "target_sol" numeric NOT NULL,
    "refill_sol" numeric NOT NULL,
    "in_amount" text NOT NULL,
    "out_amount" text NOT NULL,
    "funding_token" text NOT NULL,
    "funding_mint" text NOT NULL,
    "slippage_bps" integer NOT NULL,
    "serialized_transaction" text,
    "quote_json" text,
    "status" text NOT NULL DEFAULT 'pending_signature',
    "signature" text,
    "failure_reason" text,
    "signed_at" timestamp,
    "confirmed_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "gas_tank_refills_rule_idx" ON "gas_tank_refills" ("rule_id")`,
  `CREATE INDEX IF NOT EXISTS "gas_tank_refills_wallet_idx" ON "gas_tank_refills" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "gas_tank_refills_status_idx" ON "gas_tank_refills" ("status")`,
  `CREATE INDEX IF NOT EXISTS "gas_tank_refills_created_idx" ON "gas_tank_refills" ("created_at")`,
];

export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  }
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'gastank-2026-04-27';
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
    const rules = await sql.query(`SELECT to_regclass('public.gas_tank_rules') AS exists`);
    const refills = await sql.query(`SELECT to_regclass('public.gas_tank_refills') AS exists`);
    return NextResponse.json({
      success: true,
      rulesTable: rules[0]?.exists ?? null,
      refillsTable: refills[0]?.exists ?? null,
      results,
      reminder: 'DELETE this route file now: src/app/api/admin/run-gas-tank-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
