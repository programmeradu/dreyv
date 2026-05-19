/**
 * GET /api/inbox/subagents?wallet=<connected wallet> — list active sub-agents.
 * Wallet-scoped when `wallet` is provided, otherwise workspace-wide.
 */
import { NextResponse } from "next/server";
import { listActiveSubAgents, resolveUserIdFromWallet } from "@/lib/agents/brains/storage";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const userId = wallet ? await resolveUserIdFromWallet(wallet) : null;
  const rows = await listActiveSubAgents(100, { userId });
  return NextResponse.json({ ok: true, subagents: rows, scopedTo: userId ?? null });
}
