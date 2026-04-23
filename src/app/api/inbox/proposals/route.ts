/**
 * GET  /api/inbox/proposals — list open proposals/alerts
 * PATCH /api/inbox/proposals — { id, status } update lifecycle
 *
 * Used by `/app/inbox`. No auth gate yet — proposals are workspace-wide
 * in Phase 4; per-user routing comes in Phase 5 with treasury watchers.
 */
import { NextResponse } from "next/server";
import { listOpenProposals, setProposalStatus } from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await listOpenProposals(100);
  return NextResponse.json({ ok: true, proposals: rows });
}

export async function PATCH(req: Request) {
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
