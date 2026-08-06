/**
 * DACS Phase 5 — Episode recall endpoint.
 *
 * GET /api/dacs/episodes/recall?wallet=...&intent=...
 *
 * Returns the recall summary for a wallet + intent combo (counts, approval
 * rate, recent capabilities). Used by the CommandBar PipelineHeader to render
 * an "I've done this before" chip so the user sees that the planner is biased
 * by their own past behavior.
 *
 * Mirrors the auth posture of `/api/dacs/handoffs/stream`: wallet is supplied
 * by the client and queried directly. No PII leaves the row — only aggregate
 * counts.
 */
import { NextResponse } from "next/server";
import { recallEpisodes } from "@/lib/agents/dacs/episodes";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const intent = url.searchParams.get("intent");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitRaw) || 25, 1), 100);

  if (!intent) {
    return NextResponse.json(
      { error: "intent query param is required" },
      { status: 400 },
    );
  }

  try {
    const summary = await recallEpisodes(wallet, intent, limit);
    return NextResponse.json(
      {
        wallet,
        intent,
        ...summary,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=5",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "recall failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
