import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 7B — One-shot migration: tx_watched_wallets, tx_events, tx_category_rules.
 *
 * Usage: POST /api/admin/run-tx-stream-migration?token=<MIGRATION_TOKEN>
 * Default token (when env not set): "tx-stream-2026-04-26".
 *
 * DELETE this route after applying.
 */
const MIGRATION_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "tx_watched_wallets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "owner_wallet" text,
    "source" text NOT NULL DEFAULT 'user',
    "label" text,
    "helius_webhook_id" text,
    "active" boolean NOT NULL DEFAULT true,
    "last_synced_signature" text,
    "last_synced_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT tx_watched_wallets_wallet_owner_uniq UNIQUE ("wallet_address", "owner_wallet")
  )`,
  `CREATE INDEX IF NOT EXISTS "tx_watched_wallets_wallet_idx" ON "tx_watched_wallets" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "tx_watched_wallets_owner_idx" ON "tx_watched_wallets" ("owner_wallet")`,
  `CREATE INDEX IF NOT EXISTS "tx_watched_wallets_active_idx" ON "tx_watched_wallets" ("active")`,

  `CREATE TABLE IF NOT EXISTS "tx_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "signature" text NOT NULL,
    "slot" integer,
    "block_time" timestamp,
    "fee_lamports" integer,
    "source" text,
    "type" text,
    "direction" text,
    "counterparty" text,
    "token_mint" text,
    "token_symbol" text,
    "amount" numeric,
    "amount_lamports" numeric,
    "value_usd" numeric,
    "category" text NOT NULL DEFAULT 'uncategorized',
    "category_source" text,
    "matched_rule_id" uuid,
    "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "raw" jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT tx_events_wallet_sig_uniq UNIQUE ("wallet_address", "signature")
  )`,
  `CREATE INDEX IF NOT EXISTS "tx_events_wallet_time_idx" ON "tx_events" ("wallet_address", "block_time")`,
  `CREATE INDEX IF NOT EXISTS "tx_events_category_idx" ON "tx_events" ("category")`,
  `CREATE INDEX IF NOT EXISTS "tx_events_block_time_idx" ON "tx_events" ("block_time")`,

  `CREATE TABLE IF NOT EXISTS "tx_category_rules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_wallet" text NOT NULL,
    "name" text NOT NULL,
    "match_program_id" text,
    "match_source" text,
    "match_counterparty" text,
    "match_token_mint" text,
    "match_memo_contains" text,
    "match_min_amount" numeric,
    "match_max_amount" numeric,
    "match_direction" text,
    "category" text NOT NULL,
    "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "priority" integer NOT NULL DEFAULT 100,
    "enabled" boolean NOT NULL DEFAULT true,
    "hits" integer NOT NULL DEFAULT 0,
    "last_matched_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "tx_category_rules_owner_idx" ON "tx_category_rules" ("owner_wallet")`,
  `CREATE INDEX IF NOT EXISTS "tx_category_rules_enabled_idx" ON "tx_category_rules" ("enabled")`,
  `CREATE INDEX IF NOT EXISTS "tx_category_rules_priority_idx" ON "tx_category_rules" ("priority")`,
];

export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'tx-stream-2026-04-26';
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
    const checks = await sql.query(
      `SELECT to_regclass('public.tx_watched_wallets') AS w,
              to_regclass('public.tx_events') AS e,
              to_regclass('public.tx_category_rules') AS r`,
    );
    return NextResponse.json({
      success: true,
      tables: checks[0],
      results,
      reminder: 'DELETE this route file now: src/app/api/admin/run-tx-stream-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
