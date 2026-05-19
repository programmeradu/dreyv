/**
 * GET  /api/inbox/proposals?wallet=<connected wallet> — list open proposals/alerts.
 *      When `wallet` is provided we resolve it to a user_id and return only
 *      proposals scoped to that user. Without `wallet`, returns workspace-wide
 *      (unscoped) proposals — useful for the brain operator view.
 * PATCH /api/inbox/proposals — { id, status } update lifecycle.
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";
import {
  listOpenProposals,
  setProposalStatus,
  resolveUserIdFromWallet,
} from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const userId = wallet ? await resolveUserIdFromWallet(wallet) : null;
  const rows = await listOpenProposals(100, { userId });
  return NextResponse.json({ ok: true, proposals: rows, scopedTo: userId ?? null });
}

export async function PATCH(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const id = body?.id;
  const status = body?.status;
  if (!id || !status || !["open", "dismissed", "acted", "expired"].includes(status)) {
    return NextResponse.json({ ok: false, error: "bad_args" }, { status: 400 });
  }
  const ok = await setProposalStatus(id, status as "open" | "dismissed" | "acted" | "expired");
  return NextResponse.json({ ok });
}
