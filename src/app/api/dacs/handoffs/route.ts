/**
 * DACS Phase 5.2 — Handoffs read API.
 *
 * GET /api/dacs/handoffs?wallet=...&commandId=...&limit=50
 *   Returns persisted AgentReport rows newest-first. `commandId` returns
 *   the full timeline for a single command; `wallet` returns the most
 *   recent handoffs across that wallet's commands.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { dacsHandoffs } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) {
    return NextResponse.json({ ok: false, error: "db_unavailable", handoffs: [] }, { status: 503 });
  }
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const commandId = url.searchParams.get("commandId");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);

  const filters = [
    wallet ? eq(dacsHandoffs.walletAddress, wallet) : undefined,
    commandId ? eq(dacsHandoffs.commandId, commandId) : undefined,
  ].filter(Boolean) as ReturnType<typeof eq>[];

  const rows = await db
    .select()
    .from(dacsHandoffs)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(dacsHandoffs.createdAt))
    .limit(limit);

  return NextResponse.json({ ok: true, handoffs: rows });
}
