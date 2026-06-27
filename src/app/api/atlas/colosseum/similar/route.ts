/**
 * GET /api/atlas/colosseum/similar?slug=...&limit=6
 *
 * Cached "projects similar to X" results from Colosseum Copilot.
 */
import { NextResponse } from "next/server";
import { getSimilarProjects, isColosseumConfigured } from "@/lib/colosseum/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") || url.searchParams.get("q") || "").trim();
  const limit = Number.parseInt(url.searchParams.get("limit") || "6", 10);
  if (!slug || slug.length < 2) {
    return NextResponse.json({ error: "query parameter `slug` is required (min 2 chars)" }, { status: 400 });
  }
  if (!isColosseumConfigured()) {
    return NextResponse.json(
      { slug, similar: [], cached: false, source: "unconfigured", note: "COLOSSEUM_COPILOT_PAT missing" },
      { status: 200, headers: { "Cache-Control": "public, max-age=300" } },
    );
  }
  try {
    const result = await getSimilarProjects(slug, { limit: Number.isFinite(limit) ? limit : 6 });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    return NextResponse.json(
      { slug, similar: [], cached: false, source: "error", error: err instanceof Error ? err.message : "copilot_failed" },
      { status: 200 },
    );
  }
}
