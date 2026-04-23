/**
 * GET /api/inbox/subagents?wallet=<connected wallet> — list active sub-agents.
 * Wallet-scoped when `wallet` is provided, otherwise workspace-wide.
 */
import { NextResponse } from "next/server";
import { listActiveSubAgents, resolveUserIdFromWallet } from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const userId = wallet ? await resolveUserIdFromWallet(wallet) : null;
  const rows = await listActiveSubAgents(100, { userId });
  return NextResponse.json({ ok: true, subagents: rows, scopedTo: userId ?? null });
}
