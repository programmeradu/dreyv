export const runtime = "edge";
/**
 * Treasury watcher management API.
 *   GET    /api/inbox/watchers?wallet=<connected wallet>  → list watchers for that user
 *   POST   /api/inbox/watchers   { walletAddress, chain, address, label? }
 *   DELETE /api/inbox/watchers?id=<watcherId>
 *
 * `walletAddress` is the connected SIWS wallet (the user). `address` is the
 * external wallet to watch (can be Solana or EVM). No auth gate yet — the
 * inbox UI passes the connected wallet directly; production should enforce
 * a session check here.
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";
import {
  listWatchersByWallet,
  upsertWatcher,
  deleteWatcher,
  type WatcherChain,
} from "@/lib/agents/brains/watchers";

export const dynamic = "force-dynamic";

const VALID_CHAINS: WatcherChain[] = ["solana", "ethereum", "base", "arbitrum", "polygon", "bsc"];

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ ok: true, watchers: [] });
  const rows = await listWatchersByWallet(wallet);
  return NextResponse.json({ ok: true, watchers: rows });
}

export async function POST(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { walletAddress?: string; chain?: string; address?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { walletAddress, chain, address, label } = body ?? {};
  if (!walletAddress || !chain || !address) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }
  if (!VALID_CHAINS.includes(chain as WatcherChain)) {
    return NextResponse.json({ ok: false, error: "bad_chain" }, { status: 400 });
  }
  const row = await upsertWatcher({
    walletAddress,
    chain: chain as WatcherChain,
    address,
    label,
  });
  return NextResponse.json({ ok: !!row, watcher: row });
}

export async function DELETE(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "missing_id" }, { status: 400 });
  const ok = await deleteWatcher(id);
  return NextResponse.json({ ok });
}
