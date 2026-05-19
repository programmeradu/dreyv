/**
 * GET   /api/inbox/tx-proposals?wallet=&status=queued — list HITL tx proposals.
 * PATCH /api/inbox/tx-proposals — { id, action, signature?, errorMessage? }
 *   action: 'approve' | 'reject' | 'submitted' | 'confirmed' | 'failed'
 *
 * The wallet/multisig signer pulls a row, signs locally, then PATCHes
 * back with the resulting signature. We never sign server-side.
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";
import {
  listQueuedTxProposals,
  updateTxProposalStatus,
  resolveUserIdFromWallet,
  getTxProposal,
  insertTxProposal,
  type InsertTxProposalInput,
} from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const status = url.searchParams.get("status") ?? "queued";
  const userId = wallet ? await resolveUserIdFromWallet(wallet) : null;
  const rows = await listQueuedTxProposals(100, { userId, status });
  return NextResponse.json({ ok: true, txProposals: rows, scopedTo: userId ?? null });
}

const VALID_ACTIONS = new Set(["approve", "reject", "submitted", "confirmed", "failed"]);

/**
 * POST /api/inbox/tx-proposals — enqueue a HITL tx proposal.
 *
 * Body:
 *   {
 *     wallet?: string;            // resolved → userId
 *     kind: string;               // 'mass-send' | 'transfer' | 'swap' | ...
 *     summary: string;
 *     instructions?: unknown[];   // structured ix list (preferred for mass-send)
 *     unsignedTx?: string;        // OR a base64 unsigned tx
 *     riskLevel?: 'low'|'medium'|'high';
 *     routing?: 'wallet'|'multisig';
 *     multisigVault?: string;
 *     estimatedFeeSol?: number;
 *     meta?: Record<string, unknown>;
 *     ttlMinutes?: number;
 *   }
 */
export async function POST(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Partial<InsertTxProposalInput> & { wallet?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body?.kind || !body?.summary) {
    return NextResponse.json({ ok: false, error: "kind_and_summary_required" }, { status: 400 });
  }
  const userId = body.wallet ? await resolveUserIdFromWallet(body.wallet) : null;
  const row = await insertTxProposal({
    userId,
    proposalId: body.proposalId ?? null,
    chain: body.chain ?? "solana",
    kind: body.kind,
    summary: body.summary,
    unsignedTx: body.unsignedTx ?? null,
    instructions: body.instructions ?? null,
    estimatedFeeSol: body.estimatedFeeSol ?? null,
    riskLevel: body.riskLevel ?? "medium",
    routing: body.routing ?? "wallet",
    multisigVault: body.multisigVault ?? null,
    meta: body.meta ?? null,
    ttlMinutes: body.ttlMinutes ?? 60,
  });
  if (!row) {
    return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: row.id });
}

export async function PATCH(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
