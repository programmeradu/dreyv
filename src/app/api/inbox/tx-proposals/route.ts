/**
 * GET   /api/inbox/tx-proposals?wallet=&status=queued — list HITL tx proposals.
 * PATCH /api/inbox/tx-proposals — { id, action, signature?, errorMessage? }
 *   action: 'approve' | 'reject' | 'submitted' | 'confirmed' | 'failed'
 *
 * The wallet/multisig signer pulls a row, signs locally, then PATCHes
 * back with the resulting signature. We never sign server-side.
 */
import { NextResponse } from "next/server";
import {
  listQueuedTxProposals,
  updateTxProposalStatus,
  resolveUserIdFromWallet,
  getTxProposal,
} from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const status = url.searchParams.get("status") ?? "queued";
  const userId = wallet ? await resolveUserIdFromWallet(wallet) : null;
  const rows = await listQueuedTxProposals(100, { userId, status });
  return NextResponse.json({ ok: true, txProposals: rows, scopedTo: userId ?? null });
}

const VALID_ACTIONS = new Set(["approve", "reject", "submitted", "confirmed", "failed"]);

export async function PATCH(req: Request) {
  let body: {
    id?: string;
    action?: string;
    signature?: string;
    errorMessage?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { id, action } = body;
  if (!id || !action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "bad_args" }, { status: 400 });
  }

  const existing = await getTxProposal(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const statusMap: Record<string, "approved" | "rejected" | "submitted" | "confirmed" | "failed"> = {
    approve: "approved",
    reject: "rejected",
    submitted: "submitted",
    confirmed: "confirmed",
    failed: "failed",
  };

  const ok = await updateTxProposalStatus(id, {
    status: statusMap[action],
    signature: body.signature ?? null,
    errorMessage: body.errorMessage ?? null,
  });

  return NextResponse.json({ ok, id, status: statusMap[action] });
}
