/**
 * /api/treasury/gas-tank — auto-top-up watcher per vault.
 *
 *   GET   ?wallet=…    return the watcher (single) for this vault
 *   PUT   { wallet, minSol, targetSol, fundingAddress?, capPerTopupSol?, status? }
 *           upsert (one watcher per vault)
 *   PATCH { wallet, action: 'pause'|'resume'|'check-now' }
 *   DELETE?wallet=…    remove watcher
 *
 * The actual balance polling runs in the always-on watcher worker
 * (workers/treasury-agent). This route only persists config + handles
 * "check now" which forces a single read + (if below threshold) enqueues
 * a top-up tx proposal.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { treasuryGasTankWatchers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveUserIdFromWallet, insertTxProposal } from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ ok: true, watcher: null });
  const [row] = await db.select().from(treasuryGasTankWatchers).where(eq(treasuryGasTankWatchers.vaultAddress, wallet)).limit(1);
  return NextResponse.json({ ok: true, watcher: row ?? null });
}

export async function PUT(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { wallet, minSol, targetSol, fundingAddress = null, capPerTopupSol = 1, status = "active" } = body ?? {};
  if (!wallet || minSol == null || targetSol == null) {
    return NextResponse.json({ ok: false, error: "wallet_min_target_required" }, { status: 400 });
  }
  const userId = await resolveUserIdFromWallet(wallet);
  const [existing] = await db.select().from(treasuryGasTankWatchers).where(eq(treasuryGasTankWatchers.vaultAddress, wallet)).limit(1);
  if (existing) {
    const [row] = await db.update(treasuryGasTankWatchers).set({
      minSol: String(minSol), targetSol: String(targetSol),
      fundingAddress, capPerTopupSol: String(capPerTopupSol),
      status, updatedAt: new Date(),
    }).where(eq(treasuryGasTankWatchers.vaultAddress, wallet)).returning();
    return NextResponse.json({ ok: true, watcher: row });
  }
  const [row] = await db.insert(treasuryGasTankWatchers).values({
    userId, vaultAddress: wallet,
    minSol: String(minSol), targetSol: String(targetSol),
    fundingAddress, capPerTopupSol: String(capPerTopupSol),
    status,
  }).returning();
  return NextResponse.json({ ok: true, watcher: row });
}

export async function PATCH(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { wallet, action } = body ?? {};
  if (!wallet || !action) return NextResponse.json({ ok: false, error: "wallet_action_required" }, { status: 400 });
  const [existing] = await db.select().from(treasuryGasTankWatchers).where(eq(treasuryGasTankWatchers.vaultAddress, wallet)).limit(1);
  if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  if (action === "pause" || action === "resume") {
    await db.update(treasuryGasTankWatchers).set({
      status: action === "pause" ? "paused" : "active",
      updatedAt: new Date(),
    }).where(eq(treasuryGasTankWatchers.vaultAddress, wallet));
    return NextResponse.json({ ok: true });
  }

  if (action === "check-now") {
    // Lightweight balance check via Helius RPC
    let balanceSol: number | null = null;
    try {
      const rpc = process.env.HELIUS_RPC_URL || `https://api.mainnet-beta.solana.com`;
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [wallet] }),
      });
      const json = await res.json();
      const lamports = json?.result?.value;
      if (typeof lamports === "number") balanceSol = lamports / 1e9;
    } catch { /* ignore — leave null */ }

    await db.update(treasuryGasTankWatchers).set({
      lastBalanceSol: balanceSol != null ? String(balanceSol) : null,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(treasuryGasTankWatchers.vaultAddress, wallet));

    let queuedTxId: string | null = null;
    const minSol = Number(existing.minSol);
    const targetSol = Number(existing.targetSol);
    if (balanceSol != null && balanceSol < minSol && existing.fundingAddress) {
      const topUp = Math.min(targetSol - balanceSol, Number(existing.capPerTopupSol));
      const tx = await insertTxProposal({
        userId: existing.userId,
        kind: "transfer",
        summary: `Gas tank top-up · ${topUp.toFixed(3)} SOL → ${wallet.slice(0, 8)}…`,
        instructions: [{ type: "transfer", from: existing.fundingAddress, to: wallet, amount: topUp, token: "SOL", memo: "gas-tank top-up" }],
        riskLevel: "low",
        routing: "wallet",
        meta: { source: "gas-tank", vault: wallet, balanceSol, minSol, targetSol },
        ttlMinutes: 60,
      });
      queuedTxId = tx?.id ?? null;
      if (queuedTxId) {
        await db.update(treasuryGasTankWatchers).set({ lastTopupAt: new Date() }).where(eq(treasuryGasTankWatchers.vaultAddress, wallet));
      }
    }
    return NextResponse.json({ ok: true, balanceSol, queuedTxId });
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ ok: false, error: "wallet_required" }, { status: 400 });
  await db.delete(treasuryGasTankWatchers).where(eq(treasuryGasTankWatchers.vaultAddress, wallet));
  return NextResponse.json({ ok: true });
}
