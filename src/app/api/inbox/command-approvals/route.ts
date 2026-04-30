/**
 * GET   /api/inbox/command-approvals?wallet=&status=pending
 * PATCH /api/inbox/command-approvals  { id, status: 'approved'|'rejected', note? }
 *
 * Surfaces DACS Phase-2 router-queued plans (`command_approvals` table) so
 * the chat's "queued for approval" handoff actually shows up in /app/inbox.
 *
 * Best-effort: returns an empty list (not 500) when the table is missing,
 * so the inbox still loads on environments where the migration hasn't run.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { commandApprovals } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { publish } from "@/lib/agents/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_MISSING = /relation .*command_approvals.* does not exist/i;

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ ok: true, approvals: [], reason: "db_unavailable" });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const status = url.searchParams.get("status") ?? "pending";

  try {
    const where = wallet
      ? and(eq(commandApprovals.status, status), eq(commandApprovals.walletAddress, wallet))
      : eq(commandApprovals.status, status);
    const rows = await db
      .select()
      .from(commandApprovals)
      .where(where)
      .orderBy(desc(commandApprovals.createdAt))
      .limit(50);
    return NextResponse.json({ ok: true, approvals: rows });
  } catch (err: any) {
    if (TABLE_MISSING.test(err?.message ?? "")) {
      return NextResponse.json({ ok: true, approvals: [], reason: "table_missing" });
    }
    console.warn("[inbox:command-approvals] GET failed", err?.message);
    return NextResponse.json({ ok: true, approvals: [], reason: "error" });
  }
}

export async function PATCH(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  let body: { id?: string; status?: "approved" | "rejected"; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body.id || !body.status || !["approved", "rejected"].includes(body.status)) {
    return NextResponse.json({ ok: false, error: "id_and_status_required" }, { status: 400 });
  }

  try {
    const [row] = await db
      .update(commandApprovals)
      .set({
        status: body.status,
        resolvedAt: new Date(),
        resolutionNote: body.note ?? null,
      })
      .where(eq(commandApprovals.id, body.id))
      .returning();
    if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    // Fire DACS resolution event so the executor picks up approved plans.
    try {
      await publish({
        name: "agent.approval.resolved",
        data: {
          approvalId: row.id,
          status: body.status,
          commandId: row.commandId,
          walletAddress: row.walletAddress,
        },
      });
    } catch (e: any) {
      console.warn("[inbox:command-approvals] publish failed", e?.message);
    }

    return NextResponse.json({ ok: true, approval: row });
  } catch (err: any) {
    if (TABLE_MISSING.test(err?.message ?? "")) {
      return NextResponse.json({ ok: false, error: "table_missing" }, { status: 503 });
    }
    console.warn("[inbox:command-approvals] PATCH failed", err?.message);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
