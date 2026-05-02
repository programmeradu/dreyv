/**
 * GET /api/treasury/watcher-events?wallet=…&since=<iso>
 *
 * Returns recent agent_episodes rows produced by the four treasury-domain
 * sub-agent watchers (runway autopilot, liquidation, gas-tank, grants), so
 * the client can stream them as narrative blocks into the treasury canvas.
 *
 * Real data only — no synthesis. If a watcher hasn't fired, the array is empty.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { agentEpisodes } from "@/db/schema";
import { and, eq, gt, desc, inArray, or, isNull } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WATCHER_INTENTS = [
  "policy.runway_autopilot",
  "risk.liquidation_watch",
  "gas_tank_refill_drafted",
  "grant_milestone",
] as const;

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ events: [] });

  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (!wallet) return NextResponse.json({ events: [] });

  try {
    const rows = await db
      .select({
        id: agentEpisodes.id,
        commandId: agentEpisodes.commandId,
        walletAddress: agentEpisodes.walletAddress,
        intentKind: agentEpisodes.intentKind,
        outcome: agentEpisodes.outcome,
        valueUsd: agentEpisodes.valueUsd,
        notes: agentEpisodes.notes,
        createdAt: agentEpisodes.createdAt,
      })
      .from(agentEpisodes)
      .where(
        and(
          inArray(agentEpisodes.intentKind, WATCHER_INTENTS as unknown as string[]),
          gt(agentEpisodes.createdAt, since),
          or(eq(agentEpisodes.walletAddress, wallet), isNull(agentEpisodes.walletAddress)),
        ),
      )
      .orderBy(desc(agentEpisodes.createdAt))
      .limit(50);

    return NextResponse.json({ events: rows });
  } catch (err) {
    return NextResponse.json(
      { events: [], error: err instanceof Error ? err.message : "query_failed" },
      { status: 200 },
    );
  }
}
