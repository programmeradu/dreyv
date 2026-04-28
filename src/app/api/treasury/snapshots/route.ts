/**
 * /api/treasury/snapshots
 *
 * GET  ?wallet=…&range=24h|7d|30d|90d|all
 *      → time-series of treasury_snapshots for the chart on /app/analytics.
 *
 * POST { wallet, vault?, totalUsd, stableUsd?, volatileUsd?, yieldUsd?,
 *        composition?: TokenSlice[] }
 *      → write one snapshot row. Used by the client every ~5 min while the
 *        Analytics/Treasury page is open, and by the Inngest snapshot cron.
 *
 * Phase 14 — foundation table for the foresight engine.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { treasurySnapshots } from "@/db/schema";
import { and, eq, gte, desc, sql as dsql } from "drizzle-orm";
import { resolveUserIdFromWallet } from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGE_MS: Record<string, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  all: null,
};

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const range = url.searchParams.get("range") ?? "30d";
  if (!wallet) return NextResponse.json({ ok: true, snapshots: [] });

  const window = RANGE_MS[range] ?? RANGE_MS["30d"]!;
  const since = window ? new Date(Date.now() - window) : new Date(0);

  const rows = await db
    .select({
      id: treasurySnapshots.id,
      capturedAt: treasurySnapshots.capturedAt,
      totalUsd: treasurySnapshots.totalUsd,
      stableUsd: treasurySnapshots.stableUsd,
      volatileUsd: treasurySnapshots.volatileUsd,
      yieldUsd: treasurySnapshots.yieldUsd,
    })
    .from(treasurySnapshots)
    .where(
      and(
        eq(treasurySnapshots.walletAddress, wallet),
        gte(treasurySnapshots.capturedAt, since),
      ),
    )
    .orderBy(treasurySnapshots.capturedAt);

  // Compute realized drift / vol from the snapshot history — used by the
  // foresight engine when no explicit baseline is provided.
  const series = rows.map((r) => Number(r.totalUsd));
  const stats = computeDriftStats(series);

  return NextResponse.json({ ok: true, snapshots: rows, stats });
}

export async function POST(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const wallet = String(body?.wallet ?? "").trim();
  const totalUsd = Number(body?.totalUsd);
  if (!wallet || !Number.isFinite(totalUsd) || totalUsd < 0) {
    return NextResponse.json({ ok: false, error: "wallet_and_totalUsd_required" }, { status: 400 });
  }

  // Throttle: skip if a snapshot was written in the last 60s for this wallet.
  const recent = await db
    .select({ id: treasurySnapshots.id, capturedAt: treasurySnapshots.capturedAt })
    .from(treasurySnapshots)
    .where(eq(treasurySnapshots.walletAddress, wallet))
    .orderBy(desc(treasurySnapshots.capturedAt))
    .limit(1);
  if (recent[0] && Date.now() - new Date(recent[0].capturedAt).getTime() < 60_000) {
    return NextResponse.json({ ok: true, throttled: true, snapshot: recent[0] });
  }

  const userId = await resolveUserIdFromWallet(wallet).catch(() => null);
  const composition = Array.isArray(body?.composition) ? body.composition : [];

  const stable = composition
    .filter((t: any) => t?.isStable)
    .reduce((s: number, t: any) => s + (Number(t?.valueUsd) || 0), 0);
  const volatile = composition
    .filter((t: any) => !t?.isStable)
    .reduce((s: number, t: any) => s + (Number(t?.valueUsd) || 0), 0);

  const inserted = await db
    .insert(treasurySnapshots)
    .values({
      userId: userId ?? null,
      walletAddress: wallet,
      vaultAddress: body?.vault ?? null,
      totalUsd: String(totalUsd),
      stableUsd: String(Number.isFinite(body?.stableUsd) ? body.stableUsd : stable),
      volatileUsd: String(Number.isFinite(body?.volatileUsd) ? body.volatileUsd : volatile),
      yieldUsd: String(Number.isFinite(body?.yieldUsd) ? body.yieldUsd : 0),
      composition,
      source: body?.source ?? "wallet",
    })
    .returning();

  return NextResponse.json({ ok: true, snapshot: inserted[0] });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function computeDriftStats(series: number[]) {
  if (series.length < 2) return { driftPctPerDay: 0, volPctPerDay: 0, samples: series.length };
  const rets: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    if (prev > 0) rets.push((series[i] - prev) / prev);
  }
  if (rets.length === 0) return { driftPctPerDay: 0, volPctPerDay: 0, samples: series.length };
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length;
  return {
    driftPctPerDay: mean,
    volPctPerDay: Math.sqrt(variance),
    samples: series.length,
  };
}
