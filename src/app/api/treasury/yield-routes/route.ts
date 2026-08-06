/**
 * /api/treasury/yield-routes — policy-bounded yield routing per vault.
 *
 *   GET    ?wallet=…[&live=1]   list routes (optionally with live balance/APY snapshot per route)
 *   POST   { wallet, token, venue, riskBand, targetAmount, minApyBps?, notes? }
 *   PATCH  { id, action: 'arm'|'pause'|'resume'|'deploy'|'exit', wallet }
 *   DELETE ?id=…&wallet=…
 *
 * Real allocation/exits are HITL — they enqueue a tx proposal. `arm` flips the
 * route into the auto-deploy state so the inflow watcher will draft the deploy
 * proposal as soon as enough idle balance lands in the vault.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { treasuryYieldRoutes } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { resolveUserIdFromWallet, insertTxProposal } from "@/lib/agents/brains/storage";
import { resolveTokenMint, tokenDecimals } from "@/lib/agents/capabilities/tokens";
import { findJupiterEarnMarket, earnApyPct } from "@/lib/agents/capabilities/jupiter-earn";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const RPC =
  process.env.HELIUS_RPC_URL ||
  (process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : null) ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

async function fetchSolBalance(address: string): Promise<number | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json();
    const lamports = json?.result?.value;
    return typeof lamports === "number" ? lamports / 1e9 : null;
  } catch { return null; }
}

async function fetchTokenBalance(owner: string, token: string): Promise<number | null> {
  if (token.toUpperCase() === "SOL") return fetchSolBalance(owner);
  const mint = resolveTokenMint(token);
  if (!mint) return null;
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json();
    const accounts = json?.result?.value ?? [];
    return accounts.reduce((sum: number, a: any) => {
      const amt = a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      return sum + (typeof amt === "number" ? amt : 0);
    }, 0);
  } catch { return null; }
}

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const live = url.searchParams.get("live") === "1";
  if (!wallet) return NextResponse.json({ ok: true, routes: [] });
  const rows = await db
    .select()
    .from(treasuryYieldRoutes)
    .where(eq(treasuryYieldRoutes.vaultAddress, wallet))
    .orderBy(desc(treasuryYieldRoutes.createdAt));

  if (!live) return NextResponse.json({ ok: true, routes: rows });

  // Live mode: per-route live APY + idle balance for the configured token.
  const tokens = Array.from(new Set(rows.map((r) => r.token)));
  const balances = await Promise.all(tokens.map(async (t) => [t, await fetchTokenBalance(wallet, t)] as const));
  const balByTok = new Map(balances);
  const apyByTok = new Map<string, number>();
  await Promise.all(
    tokens.map(async (t) => {
      try {
        const m = await findJupiterEarnMarket(t);
        if (m) apyByTok.set(t, Math.round(earnApyPct(m) * 100));
      } catch { /* ignore */ }
    }),
  );

  const enriched = rows.map((r) => {
    const liveBalance = balByTok.get(r.token) ?? null;
    const liveApyBps = apyByTok.get(r.token) ?? null;
    const target = Number(r.targetAmount) || 0;
    const idleAvail = liveBalance != null ? Math.min(target > 0 ? target : liveBalance, liveBalance) : null;
    return {
      ...r,
      live: {
        balance: liveBalance,
        apyBps: liveApyBps,
        idleAvail,
        readyToDeploy:
          r.status === "armed" && liveBalance != null && idleAvail != null && idleAvail > 0
          && (r.minApyBps == null || (liveApyBps != null && liveApyBps >= r.minApyBps)),
      },
    };
  });

  return NextResponse.json({ ok: true, routes: enriched });
}

export async function POST(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { wallet, token = "USDC", venue, riskBand = "conservative", targetAmount = 0, minApyBps = null, notes = null } = body ?? {};
  if (!wallet || !venue) {
    return NextResponse.json({ ok: false, error: "wallet_venue_required" }, { status: 400 });
  }
  const userId = await resolveUserIdFromWallet(wallet);
  const [row] = await db.insert(treasuryYieldRoutes).values({
    userId, vaultAddress: wallet, token, venue, riskBand,
    targetAmount: String(targetAmount), minApyBps, notes,
    status: "draft",
  }).returning();
  return NextResponse.json({ ok: true, route: row });
}

export async function PATCH(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { id, wallet, action } = body ?? {};
  if (!id || !wallet || !action) return NextResponse.json({ ok: false, error: "id_wallet_action_required" }, { status: 400 });
  const [existing] = await db.select().from(treasuryYieldRoutes)
    .where(and(eq(treasuryYieldRoutes.id, id), eq(treasuryYieldRoutes.vaultAddress, wallet))).limit(1);
  if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  if (action === "arm") {
    const [row] = await db.update(treasuryYieldRoutes).set({
      status: "armed", updatedAt: new Date(),
    }).where(eq(treasuryYieldRoutes.id, id)).returning();
    return NextResponse.json({ ok: true, route: row, message: "Armed — will auto-draft deploy on next stable inflow (HITL approval still required)." });
  }

  if (action === "pause" || action === "resume") {
    const [row] = await db.update(treasuryYieldRoutes).set({
      status: action === "pause" ? "paused" : "active",
      updatedAt: new Date(),
    }).where(eq(treasuryYieldRoutes.id, id)).returning();
    return NextResponse.json({ ok: true, route: row });
  }

  if (action === "deploy" || action === "exit") {
    const isDeploy = action === "deploy";
    const tx = await insertTxProposal({
      userId: existing.userId,
      kind: isDeploy ? "yield-deposit" : "yield-withdraw",
      summary: `${isDeploy ? "Deploy" : "Exit"} ${existing.token} → ${existing.venue} · ${Number(existing.targetAmount)}`,
      instructions: [{
        type: isDeploy ? "yield-deposit" : "yield-withdraw",
        venue: existing.venue,
        token: existing.token,
        amount: Number(existing.targetAmount),
        riskBand: existing.riskBand,
        memo: `Dreyv yield route ${existing.id}`,
      }],
      riskLevel: existing.riskBand === "conservative" ? "low" : existing.riskBand === "balanced" ? "medium" : "high",
      routing: "wallet",
      meta: { source: "yield-route", routeId: existing.id, vault: wallet },
      ttlMinutes: 120,
    });
    const [row] = await db.update(treasuryYieldRoutes).set({
      status: isDeploy ? "active" : "exited",
      updatedAt: new Date(),
    }).where(eq(treasuryYieldRoutes.id, id)).returning();
    return NextResponse.json({ ok: true, route: row, queuedTxId: tx?.id ?? null });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const wallet = url.searchParams.get("wallet");
  if (!id || !wallet) return NextResponse.json({ ok: false, error: "id_wallet_required" }, { status: 400 });
  await db.delete(treasuryYieldRoutes)
    .where(and(eq(treasuryYieldRoutes.id, id), eq(treasuryYieldRoutes.vaultAddress, wallet)));
  return NextResponse.json({ ok: true });
}
