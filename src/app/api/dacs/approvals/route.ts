/**
 * DACS Phase 2 — HITL approval queue endpoints.
 *
 * GET   /api/dacs/approvals?wallet=&status=pending
 *   List approvals for a wallet (or all when wallet omitted; admin-only in
 *   Phase 6). Status defaults to "pending".
 *
 * PATCH /api/dacs/approvals
 *   Body: { id, action, note?, resolvedBy?, signature? }
 *   action: "approve" | "reject"
 *   On approve, the executor (Phase 3) will pick up the row and submit;
 *   for now we simply mark it approved so the UI flow + diff harness work.
 */
import { NextResponse } from "next/server";
import {
  listPendingApprovals,
  resolveApproval,
  getApproval,
} from "@/lib/agents/dacs/hitl-queue";
import { publish } from "@/lib/agents/bus";
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
  const rows = await listPendingApprovals(wallet, 100);
  return NextResponse.json({ ok: true, approvals: rows, scopedTo: wallet });
}

const VALID = new Set(["approve", "reject"]);

export async function PATCH(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { id?: string; action?: string; note?: string; resolvedBy?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { id, action } = body;
  if (!id || !action || !VALID.has(action)) {
    return NextResponse.json({ ok: false, error: "bad_args" }, { status: 400 });
  }

  const existing = await getApproval(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json(
      { ok: false, error: "already_resolved", status: existing.status },
      { status: 409 },
    );
  }

  const result = await resolveApproval(id, action as "approve" | "reject", {
    resolvedBy: body.resolvedBy,
    note: body.note,
  });

  // Best-effort bus signal so executors / observers can react.
  // Map approve→approved, reject→rejected so the executor can switch on status.
  const status = action === "approve" ? "approved" : "rejected";
  await publish({
    name: "agent.approval.resolved",
    data: {
      approvalId: id,
      commandId: existing.commandId,
      walletAddress: existing.walletAddress,
      action,
      status,
      resolvedBy: body.resolvedBy ?? null,
      note: body.note ?? null,
      resolvedAt: Date.now(),
    },
  });

  return NextResponse.json({ ok: true, id, status: result?.status ?? null });
}
