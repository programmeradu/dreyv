import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Phase 7D.1 — One-shot migration: add `policy_meta` JSONB to `user_agent_policy`.
 * DELETE this route after applying.
 *
 * Usage: POST /api/admin/run-policy-meta-migration?token=policymeta-2026-04-27
 */
const MIGRATION_SQL: string[] = [
  `ALTER TABLE "user_agent_policy" ADD COLUMN IF NOT EXISTS "policy_meta" jsonb`,
];

export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'policymeta-2026-04-27';
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
    const col = await sql.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='user_agent_policy' AND column_name='policy_meta'`,
    );
    return NextResponse.json({
      success: true,
      columnExists: col.length > 0,
      results,
      reminder: 'DELETE this route file: src/app/api/admin/run-policy-meta-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
