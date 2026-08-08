/**
 * GET /api/atlas/colosseum/project?slug=...
 *
 * Cached project profile from Colosseum Copilot. Backs hover cards on
 * `/atlas` and the project detail surface.
 */
import { NextResponse } from "next/server";
import { getColosseumProject, isColosseumConfigured } from "@/lib/colosseum/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") || url.searchParams.get("q") || "").trim();
  if (!slug || slug.length < 2) {
    return NextResponse.json({ error: "query parameter `slug` is required (min 2 chars)" }, { status: 400 });
  }
  if (!isColosseumConfigured()) {
    return NextResponse.json(
      { slug, project: null, cached: false, source: "unconfigured", note: "COLOSSEUM_COPILOT_PAT missing" },
      { status: 200, headers: { "Cache-Control": "public, max-age=300" } },
    );
  }
  try {
    const result = await getColosseumProject(slug);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    return NextResponse.json(
      { slug, project: null, cached: false, source: "error", error: err instanceof Error ? err.message : "copilot_failed" },
      { status: 200 },
    );
  }
}
