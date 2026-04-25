/**
 * DACS Phase 1 — admin diff log read API.
 *
 * Returns the most recent `command_diff_log` rows for the admin diff view.
 * No mutation. Auth check is intentionally deferred to the page wrapper /
 * existing admin middleware in `src/middleware.ts`; this route returns 503
 * if the database isn't configured and clamps `limit` to a safe range.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { commandDiffLog } from "@/db/schema";
import { desc, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!db) return NextResponse.json({ error: "db_not_configured" }, { status: 503 });
  const dbx = db;

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));
  const parity = req.nextUrl.searchParams.get("parity"); // optional filter

  try {
    const rows = parity
      ? await dbx
          .select()
          .from(commandDiffLog)
          .where(sql`${commandDiffLog.parity} = ${parity}`)
          .orderBy(desc(commandDiffLog.createdAt))
          .limit(limit)
      : await dbx
          .select()
          .from(commandDiffLog)
          .orderBy(desc(commandDiffLog.createdAt))
          .limit(limit);

    // Aggregate parity counts for the dashboard summary card.
    const counts = await dbx.execute<{ parity: string | null; n: number }>(
      sql`SELECT parity, COUNT(*)::int AS n FROM command_diff_log GROUP BY parity`,
    );

    return NextResponse.json({ ok: true, rows, counts: counts.rows ?? counts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
