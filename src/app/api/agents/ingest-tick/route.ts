/**
 * /api/agents/ingest-tick — endpoint the Cloudflare DO sub-agents call back
 * into when their alarm fires. The DO posts its tick context here, and we
 * fan it out to the brain's opportunity bus so the existing
 * `OpportunityRouter` (groq-triage → gemini-deep → bridge-to-tx) handles the
 * reasoning + queuing.
 *
 * This is the "DO state + alarms" half meeting the "Inngest durable workflow"
 * half — the seam of the hybrid system.
 *
 * Auth: requires `x-dreyv-agent-key` matching `DREYV_AGENT_KEY` env (same
 * shared secret the Worker uses). Without it, the endpoint silently drops.
 */
import { NextResponse } from "next/server";
import { publish } from "@/lib/agents/bus";

export const dynamic = "force-dynamic";

const HEADER = "x-dreyv-agent-key";

export async function POST(req: Request) {
  const expected = process.env.DREYV_AGENT_KEY;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  const got = req.headers.get(HEADER);
  if (got !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !body.reason) {
    return NextResponse.json({ ok: false, error: "missing_reason" }, { status: 400 });
  }

  // Forward as a normal opportunity. The brain router takes it from here.
  await publish({
    name: "agent.opportunity.surfaced",
    data: {
      ...body,
      observedAt: body.observedAt ?? new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true });
}
