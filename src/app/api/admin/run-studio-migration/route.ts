import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-shot migration runner for drizzle/0003_studio_runs.sql.
 * Protected by MIGRATION_TOKEN query param check against env (or admin secret).
 * DELETE THIS FILE after the migration is applied.
 */
export async function POST(request: NextRequest) {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, '').trim();
  if (!url) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 503 });
  }

  // Simple shared-token guard so this isn't open to the world.
  const token = request.nextUrl.searchParams.get('token');
  const expected = process.env.MIGRATION_TOKEN || 'studio-runs-2026-04-21';
  if (token !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sqlPath = path.join(process.cwd(), 'drizzle', '0003_studio_runs.sql');
    const raw = await fs.readFile(sqlPath, 'utf8');

    const sql = neon(url);

    // Split on semicolons at end of statements (simple — file has no $$ blocks).
    const statements = raw
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const results: Array<{ stmt: string; ok: boolean; error?: string }> = [];
    for (const stmt of statements) {
      try {
        await sql.query(stmt);
        results.push({ stmt: stmt.slice(0, 80), ok: true });
      } catch (err) {
        results.push({
          stmt: stmt.slice(0, 80),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Verify table exists.
    const check = await sql.query(
      `SELECT to_regclass('public.studio_runs') AS exists`
    );

    return NextResponse.json({
      success: true,
      tableExists: check[0]?.exists ?? null,
      results,
      reminder: 'DELETE this route file now: src/app/api/admin/run-studio-migration/route.ts',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
