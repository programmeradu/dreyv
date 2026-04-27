import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 7E.1 — One-shot migration: create `sniper_bot_rules` + `sniper_bot_events`.
 * DELETE this route after applying.
 *
 * Usage: POST /api/admin/run-sniper-migration?token=sniper-2026-04-27
 */
const MIGRATION_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "sniper_bot_rules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "exchange" text NOT NULL,
    "liquidity_threshold_usd" numeric NOT NULL DEFAULT '5000',
    "buy_amount_usd" numeric NOT NULL DEFAULT '25',
    "funding_token" text NOT NULL DEFAULT 'USDC',
    "funding_mint" text NOT NULL,
    "max_slippage_bps" integer NOT NULL DEFAULT 300,
    "token_allowlist" jsonb NOT NULL DEFAULT '[]',
    "token_denylist" jsonb NOT NULL DEFAULT '[]',
    "max_buys_per_day" integer NOT NULL DEFAULT 5,
    "enabled" boolean NOT NULL DEFAULT true,
    "status" text NOT NULL DEFAULT 'active',
    "helius_webhook_id" text,
    "buy_day_bucket" text,
    "buys_today" integer NOT NULL DEFAULT 0,
    "last_triggered_at" timestamp,
    "last_error" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "sniper_rules_wallet_idx" ON "sniper_bot_rules" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "sniper_rules_enabled_idx" ON "sniper_bot_rules" ("enabled")`,
  `CREATE INDEX IF NOT EXISTS "sniper_rules_exchange_idx" ON "sniper_bot_rules" ("exchange")`,
  `CREATE TABLE IF NOT EXISTS "sniper_bot_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "rule_id" uuid NOT NULL REFERENCES "sniper_bot_rules"("id") ON DELETE CASCADE,
    "wallet_address" text NOT NULL,
    "exchange" text NOT NULL,
    "detected_mint" text NOT NULL,
    "detected_symbol" text,
    "detected_signature" text NOT NULL,
    "buy_amount_usd" numeric NOT NULL,
    "funding_token" text NOT NULL,
    "in_amount" text,
    "out_amount" text,
    "slippage_bps" integer NOT NULL,
    "serialized_transaction" text,
    "quote_json" text,
    "status" text NOT NULL DEFAULT 'pending_signature',
    "signature" text,
    "failure_reason" text,
    "signed_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "sniper_events_rule_idx" ON "sniper_bot_events" ("rule_id")`,
  `CREATE INDEX IF NOT EXISTS "sniper_events_status_idx" ON "sniper_bot_events" ("status")`,
  `CREATE INDEX IF NOT EXISTS "sniper_events_created_idx" ON "sniper_bot_events" ("created_at")`,
];

export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'sniper-2026-04-27';
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
    const t1 = await sql.query(`SELECT to_regclass('public.sniper_bot_rules') AS exists`);
    const t2 = await sql.query(`SELECT to_regclass('public.sniper_bot_events') AS exists`);
    return NextResponse.json({
      success: true,
      sniperRules: t1[0]?.exists ?? null,
      sniperEvents: t2[0]?.exists ?? null,
      results,
      reminder: 'DELETE this route file: src/app/api/admin/run-sniper-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
