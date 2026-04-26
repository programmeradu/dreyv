import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 7A — One-shot migration: create `agent_artifacts` table on Neon.
 * Inline SQL (drizzle/ is read-only in this environment).
 * Protected by MIGRATION_TOKEN query param.
 *
 * Usage: POST /api/admin/run-artifacts-migration?token=<MIGRATION_TOKEN>
 * Default token (when env not set): "agent-artifacts-2026-04-26".
 *
 * DELETE this route after applying.
 */
const MIGRATION_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "agent_artifacts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_key" text NOT NULL,
    "wallet_address" text,
    "capability_id" text NOT NULL,
    "command_id" text,
    "kind" text NOT NULL,
    "filename" text NOT NULL,
    "mime" text NOT NULL,
    "bytes" integer NOT NULL,
    "body" bytea NOT NULL,
    "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "expires_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "agent_artifacts_owner_idx" ON "agent_artifacts" ("owner_key")`,
  `CREATE INDEX IF NOT EXISTS "agent_artifacts_wallet_idx" ON "agent_artifacts" ("wallet_address")`,
  `CREATE INDEX IF NOT EXISTS "agent_artifacts_kind_idx" ON "agent_artifacts" ("kind")`,
  `CREATE INDEX IF NOT EXISTS "agent_artifacts_created_idx" ON "agent_artifacts" ("created_at")`,
];

export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  }
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'agent-artifacts-2026-04-26';
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
    const check = await sql.query(`SELECT to_regclass('public.agent_artifacts') AS exists`);
    return NextResponse.json({
      success: true,
      tableExists: check[0]?.exists ?? null,
      results,
      reminder: 'DELETE this route file now: src/app/api/admin/run-artifacts-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
