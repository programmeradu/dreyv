/**
 * DACS Phase 2 — Per-user agent policy endpoints.
 *
 * GET   /api/dacs/policy?wallet=
 *   Returns the user's policy (or DEFAULT_POLICY when no row exists).
 *
 * PUT   /api/dacs/policy
 *   Body: UpsertPolicyInput. Upserts the row.
 *
 * Phase 3 will tie this to `/app/settings` so users can opt into thresholds
 * and protocol allowlists from the UI.
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";
import {
  loadUserPolicy,
  upsertUserPolicy,
  type UpsertPolicyInput,
} from "@/lib/agents/dacs/policy-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ ok: false, error: "wallet_required" }, { status: 400 });
  }
  const policy = await loadUserPolicy(wallet);
  return NextResponse.json({ ok: true, walletAddress: wallet, policy });
}

export async function PUT(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: UpsertPolicyInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body.walletAddress) {
    return NextResponse.json({ ok: false, error: "wallet_required" }, { status: 400 });
  }
  try {
    const rows = await upsertUserPolicy(body);
    return NextResponse.json({ ok: true, policy: rows[0] ?? null });
  } catch (err) {
    console.error("[dacs:policy] upsert failed:", err);
    return NextResponse.json({ ok: false, error: "upsert_failed" }, { status: 500 });
  }
}
