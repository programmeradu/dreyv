/**
 * DACS Phase 4 — Sub-agent endpoints.
 *
 * GET   /api/dacs/subagents?wallet=
 *   List sub-agents (active + terminal) for a wallet.
 *
 * PATCH /api/dacs/subagents
 *   Body: { id, action: "pause" | "resume" | "cancel" }
 */
import { NextResponse } from "next/server";
import { listSubagents, setSubagentStatus, getSubagent } from "@/lib/agents/dacs/subagent-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const rows = await listSubagents(wallet, 100);
  return NextResponse.json({ ok: true, subagents: rows, scopedTo: wallet });
}

const VALID = new Set(["pause", "resume", "cancel"]);

export async function PATCH(req: Request) {
  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { id, action } = body;
  if (!id || !action || !VALID.has(action)) {
    return NextResponse.json({ ok: false, error: "bad_args" }, { status: 400 });
  }
  const existing = await getSubagent(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const nextStatus =
    action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled";
  const result = await setSubagentStatus(id, nextStatus as never);
  return NextResponse.json({ ok: true, id, status: result?.status ?? null });
}
