/**
 * /api/treasury/yield-routes — policy-bounded yield routing per vault.
 *
 *   GET    ?wallet=…    list routes for the vault
 *   POST   { wallet, token, venue, riskBand, targetAmount, minApyBps?, notes? }
 *   PATCH  { id, action: 'pause'|'resume'|'exit', wallet }
 *   DELETE ?id=…&wallet=…
 *
 * Real allocation/exits are HITL — they enqueue a tx proposal. This route
 * persists intent, target sizes, and the latest observed APY snapshot.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { treasuryYieldRoutes } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { resolveUserIdFromWallet, insertTxProposal } from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ ok: true, routes: [] });
  const rows = await db
    .select()
    .from(treasuryYieldRoutes)
    .where(eq(treasuryYieldRoutes.vaultAddress, wallet))
    .orderBy(desc(treasuryYieldRoutes.createdAt));
  return NextResponse.json({ ok: true, routes: rows });
}

export async function POST(req: Request) {
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
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { id, wallet, action } = body ?? {};
  if (!id || !wallet || !action) return NextResponse.json({ ok: false, error: "id_wallet_action_required" }, { status: 400 });
  const [existing] = await db.select().from(treasuryYieldRoutes)
    .where(and(eq(treasuryYieldRoutes.id, id), eq(treasuryYieldRoutes.vaultAddress, wallet))).limit(1);
  if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

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
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const wallet = url.searchParams.get("wallet");
  if (!id || !wallet) return NextResponse.json({ ok: false, error: "id_wallet_required" }, { status: 400 });
  await db.delete(treasuryYieldRoutes)
    .where(and(eq(treasuryYieldRoutes.id, id), eq(treasuryYieldRoutes.vaultAddress, wallet)));
  return NextResponse.json({ ok: true });
}
