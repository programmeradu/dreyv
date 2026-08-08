/**
 * POST /api/agents/action-codes/:id/approve — human approves (or rejects)
 * an outstanding action code. SESSION auth — must be signed in via SIWS or
 * Neon Auth as the user who owns the code.
 *
 * Body: { code: string, decision?: "approve" | "reject" }
 *   - "approve" requires the 6-digit code shown to the agent (defence-in-depth
 *     against open-redirect approvals).
 *   - "reject"  bypasses the code check.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { approveCode, rejectCode } from "@/lib/agent/action-codes";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { code?: string; decision?: "approve" | "reject" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const decision = body.decision === "reject" ? "reject" : "approve";

  if (decision === "reject") {
    const ok = await rejectCode(id, user.id);
    return NextResponse.json({ ok, status: ok ? "rejected" : "no_change" });
  }

  if (!body.code || !/^\d{6}$/.test(body.code.trim())) {
    return NextResponse.json({ error: "invalid_code", note: "6 digits required" }, { status: 400 });
  }

  const res = await approveCode({ id, userId: user.id, code: body.code });
  if (!res.ok) return NextResponse.json({ error: "approval_failed", reason: res.reason }, { status: 403 });
  return NextResponse.json({ ok: true, status: "approved" });
}
