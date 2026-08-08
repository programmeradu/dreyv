export const runtime = "edge";
/**
 * GET /api/atlas/colosseum/builders?q=...&limit=8
 *
 * Cached proxy to Colosseum Copilot search. Powers the "Builders in this
 * space" widget. 24h cache lives in public.colosseum_cache; we serve stale
 * results before re-fetching upstream.
 *
 * Public route — no auth. Rate-friendly: the upstream call only happens
 * on cache miss.
 */
import { NextResponse } from "next/server";
import { getBuildersInSpace, isColosseumConfigured } from "@/lib/colosseum/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Number.parseInt(url.searchParams.get("limit") || "8", 10);

  if (!q || q.length < 2) {
    return NextResponse.json(
      { error: "query parameter `q` is required (min 2 chars)" },
      { status: 400 },
    );
  }
  if (!isColosseumConfigured()) {
    // Don't 500 — Atlas pages should still render. UI hides the widget.
    return NextResponse.json(
      { query: q, builders: [], cached: false, source: "unconfigured", note: "COLOSSEUM_COPILOT_PAT missing" },
      { status: 200, headers: { "Cache-Control": "public, max-age=300" } },
    );
  }

  try {
    const result = await getBuildersInSpace(q, {
      limit: Number.isFinite(limit) ? limit : 8,
    });
    return NextResponse.json(result, {
      headers: {
        // Edge cache for 10 min, SWR for 24h — cuts upstream further.
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "copilot_failed";
    return NextResponse.json(
      { query: q, builders: [], cached: false, source: "error", error: message },
      { status: 200 },
    );
  }
}
