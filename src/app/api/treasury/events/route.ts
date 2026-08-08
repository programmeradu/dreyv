export const runtime = "edge";
/**
 * /api/treasury/events
 *
 * GET  ?wallet=…&range=7d|30d|90d|all&kind=inflow|outflow|...
 *      → list USD-attributed treasury events + aggregates (inflow, outflow,
 *        yield, fee). Powers the Analytics attribution panel and feeds the
 *        Foresight engine's burn/inflow priors.
 *
 * POST { wallet, vault?, occurredAt, kind, amountUsd, category?, ... }
 *      → record a treasury event. Either signed by the client (manual entry,
 *        e.g. "log this off-chain inflow") or written by the Helius watcher
 *        when a tx settles.
 *
 * Phase 14 — foundation event stream for foresight attribution.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { treasuryEvents } from "@/db/schema";
import { and, eq, gte, desc, sql as dsql } from "drizzle-orm";
import { resolveUserIdFromWallet } from "@/lib/agents/brains/storage";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const RANGE_MS: Record<string, number | null> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  all: null,
};

const ALLOWED_KINDS = new Set([
  "inflow",
  "outflow",
  "yield",
  "fee",
  "swap",
  "rebalance",
  "airdrop",
  "unknown",
]);

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const range = url.searchParams.get("range") ?? "30d";
  const kind = url.searchParams.get("kind");
  if (!wallet) return NextResponse.json({ ok: true, events: [], aggregates: emptyAggregates() });

  const window = RANGE_MS[range] ?? RANGE_MS["30d"]!;
  const since = window ? new Date(Date.now() - window) : new Date(0);

  const conds = [
    eq(treasuryEvents.walletAddress, wallet),
    gte(treasuryEvents.occurredAt, since),
  ];
  if (kind && ALLOWED_KINDS.has(kind)) conds.push(eq(treasuryEvents.kind, kind));

  const rows = await db
    .select()
    .from(treasuryEvents)
    .where(and(...conds))
    .orderBy(desc(treasuryEvents.occurredAt))
    .limit(500);

  const aggregates = aggregateEvents(rows, window ?? 30 * 24 * 60 * 60 * 1000);

  return NextResponse.json({ ok: true, events: rows, aggregates });
}

export async function POST(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const wallet = String(body?.wallet ?? "").trim();
  const kind = String(body?.kind ?? "").toLowerCase();
  const amountUsd = Number(body?.amountUsd);
  if (!wallet || !ALLOWED_KINDS.has(kind) || !Number.isFinite(amountUsd)) {
    return NextResponse.json(
      { ok: false, error: "wallet_kind_amountUsd_required" },
      { status: 400 },
    );
  }
  const userId = await resolveUserIdFromWallet(wallet).catch(() => null);

  const occurredAt = body?.occurredAt ? new Date(body.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ ok: false, error: "invalid_occurredAt" }, { status: 400 });
  }

  const inserted = await db
    .insert(treasuryEvents)
    .values({
      userId: userId ?? null,
      walletAddress: wallet,
      vaultAddress: body?.vault ?? null,
      occurredAt,
      kind,
      category: body?.category ?? null,
      amountUsd: String(amountUsd),
      tokenSymbol: body?.tokenSymbol ?? null,
      tokenMint: body?.tokenMint ?? null,
      counterparty: body?.counterparty ?? null,
      signature: body?.signature ?? null,
      source: body?.source ?? "manual",
      metadata: body?.metadata ?? {},
    })
    .returning();

  return NextResponse.json({ ok: true, event: inserted[0] });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function emptyAggregates() {
  return {
    inflowUsd: 0,
    outflowUsd: 0,
    yieldUsd: 0,
    feeUsd: 0,
    netUsd: 0,
    monthlyBurnRate: 0,
    monthlyInflow: 0,
    annualYieldRate: 0,
    sampleSize: 0,
  };
}

function aggregateEvents(rows: any[], windowMs: number) {
  const agg = emptyAggregates();
  agg.sampleSize = rows.length;
  let yieldBase = 0;
  for (const r of rows) {
    const usd = Number(r.amountUsd);
    if (!Number.isFinite(usd)) continue;
    if (r.kind === "inflow") agg.inflowUsd += Math.abs(usd);
    else if (r.kind === "outflow") agg.outflowUsd += Math.abs(usd);
    else if (r.kind === "yield") {
      agg.yieldUsd += Math.abs(usd);
      yieldBase += Math.abs(Number(r?.metadata?.principalUsd) || 0);
    } else if (r.kind === "fee") agg.feeUsd += Math.abs(usd);
    agg.netUsd += usd;
  }
  const months = Math.max(1, windowMs / (30.44 * 24 * 60 * 60 * 1000));
  agg.monthlyBurnRate = (agg.outflowUsd + agg.feeUsd) / months;
  agg.monthlyInflow = agg.inflowUsd / months;
  // Annualized yield rate = realized yield over window / yield-bearing principal
  if (yieldBase > 0) {
    const yearsWindow = windowMs / (365.25 * 24 * 60 * 60 * 1000);
    agg.annualYieldRate = agg.yieldUsd / yieldBase / Math.max(yearsWindow, 1 / 365);
  }
  return agg;
}
