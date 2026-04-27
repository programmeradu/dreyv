import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 7B.4 — One-shot migration: create `grants` + `grant_milestones`.
 * Inline SQL (drizzle/ is read-only). Protected by MIGRATION_TOKEN query param.
 *
 * Usage: POST /api/admin/run-grants-migration?token=<MIGRATION_TOKEN>
 * Default token: "grants-2026-04-27".
 *
 * DELETE this route after applying.
 */
const MIGRATION_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "grants" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "funder_wallet" text NOT NULL,
    "grantee" text NOT NULL,
    "token" text NOT NULL DEFAULT 'USDC',
    "mint" text NOT NULL,
    "total_amount" numeric NOT NULL,
    "released_amount" numeric NOT NULL DEFAULT '0',
    "stream_id" text,
    "status" text NOT NULL DEFAULT 'pending_signature',
    "signature" text,
    "notes" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "grants_funder_idx" ON "grants" ("funder_wallet")`,
  `CREATE INDEX IF NOT EXISTS "grants_grantee_idx" ON "grants" ("grantee")`,
  `CREATE INDEX IF NOT EXISTS "grants_status_idx" ON "grants" ("status")`,
  `CREATE TABLE IF NOT EXISTS "grant_milestones" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "grant_id" uuid NOT NULL REFERENCES "grants"("id") ON DELETE CASCADE,
    "ordinal" integer NOT NULL,
    "label" text NOT NULL,
    "amount" numeric NOT NULL,
    "proof" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "proof_verified_at" timestamp,
    "proof_evidence" jsonb,
    "release_signature" text,
    "released_at" timestamp,
    "last_checked_at" timestamp,
    "last_check_error" text,
    "check_attempts" integer NOT NULL DEFAULT 0,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "grant_milestones_grant_idx" ON "grant_milestones" ("grant_id")`,
  `CREATE INDEX IF NOT EXISTS "grant_milestones_status_idx" ON "grant_milestones" ("status")`,
];

export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'grants-2026-04-27';
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
    const grants = await sql.query(`SELECT to_regclass('public.grants') AS exists`);
    const milestones = await sql.query(`SELECT to_regclass('public.grant_milestones') AS exists`);
    return NextResponse.json({
      success: true,
      grantsTable: grants[0]?.exists ?? null,
      milestonesTable: milestones[0]?.exists ?? null,
      results,
      reminder: 'DELETE this route file now: src/app/api/admin/run-grants-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
