/**
 * GET /api/inbox/subagents — list active sub-agents.
 */
import { NextResponse } from "next/server";
import { listActiveSubAgents } from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await listActiveSubAgents(100);
  return NextResponse.json({ ok: true, subagents: rows });
}
