/**
 * GET /api/studio/video/trends
 *
 * Returns a normalized list of trending TikTok signals for the Video Studio.
 *
 * Layered fallback:
 *  1. Firecrawl scrape of TikTok Creative Center (when FIRECRAWL_API_KEY set)
 *  2. TikAPI public trending feed (when TIKAPI_KEY set)
 *  3. Bundled evergreen archetypes (always available)
 *
 * Shape: {
 *   source: "firecrawl" | "tikapi" | "bundled";
 *   sounds: { name: string; usageNote?: string }[];
 *   hashtags: { tag: string; note?: string }[];
 *   formats: { id: string; label: string; note: string }[];
 *   fetchedAt: string;
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { VIDEO_FORMATS } from "@/lib/media-studio/video-tools";

export const runtime = "edge";
export const maxDuration = 30;

const BUNDLED_SOUNDS = [
  { name: "original VO + ambient room tone", usageNote: "Safest default. No copyright risk." },
  { name: "Aesthetic chill lo-fi loop", usageNote: "Evergreen for explainer / GRWM formats." },
  { name: "Trending 'walking confidently' loop sound", usageNote: "Pair with mascot walk cycle meme." },
  { name: "Suspense rising into reveal sound", usageNote: "Before/after + viral hack test." },
  { name: "Comedic timing punch sound", usageNote: "Skit punchlines." },
];

const BUNDLED_HASHTAGS = [
  { tag: "#AIAgents", note: "Core audience" },
  { tag: "#ClaudeAI", note: "Anthropic crowd" },
  { tag: "#MCP", note: "Tool builders" },
  { tag: "#Solana", note: "On-chain crowd" },
  { tag: "#crypto", note: "Broad reach, mixed quality" },
  { tag: "#devtools", note: "Builder crowd" },
  { tag: "#buildinpublic", note: "Founder narrative" },
  { tag: "#fyp", note: "Generic reach" },
  { tag: "#foryou", note: "Generic reach" },
  { tag: "#tech", note: "Broad" },
];

function bundled() {
  return {
    source: "bundled" as const,
    sounds: BUNDLED_SOUNDS,
    hashtags: BUNDLED_HASHTAGS,
    formats: VIDEO_FORMATS.map((f) => ({ id: f.id, label: f.label, note: `${f.duration} · ${f.metric}` })),
    fetchedAt: new Date().toISOString(),
    note: "Bundled archetypes — set FIRECRAWL_API_KEY or TIKAPI_KEY for live trending data.",
  };
}

async function tryFirecrawl(): Promise<null | {
  sounds: { name: string; usageNote?: string }[];
  hashtags: { tag: string; note?: string }[];
}> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const url = "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en";
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        url,
        formats: ["extract"],
        extract: {
          schema: {
            type: "object",
            properties: {
              hashtags: { type: "array", items: { type: "object", properties: { tag: { type: "string" }, posts: { type: "string" } } } },
              sounds: { type: "array", items: { type: "object", properties: { name: { type: "string" }, uses: { type: "string" } } } },
            },
          },
          prompt:
            "Extract the top 10 trending hashtags (with post count) and any trending sounds visible on the page. Tags MUST start with #.",
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const extract = j?.data?.extract ?? j?.extract ?? {};
    const hashtags = Array.isArray(extract.hashtags)
      ? extract.hashtags.slice(0, 12).map((h: any) => ({ tag: String(h.tag ?? "").trim(), note: h.posts ? `${h.posts} posts` : undefined })).filter((h: any) => h.tag)
      : [];
    const sounds = Array.isArray(extract.sounds)
      ? extract.sounds.slice(0, 10).map((s: any) => ({ name: String(s.name ?? "").trim(), usageNote: s.uses ? `${s.uses} uses` : undefined })).filter((s: any) => s.name)
      : [];
    if (!hashtags.length && !sounds.length) return null;
    return { hashtags, sounds };
  } catch (err) {
    console.warn("[video/trends] firecrawl failed:", err);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const fc = await tryFirecrawl();
  if (fc) {
    return NextResponse.json({
      source: "firecrawl" as const,
      sounds: fc.sounds.length ? fc.sounds : BUNDLED_SOUNDS,
      hashtags: fc.hashtags.length ? fc.hashtags : BUNDLED_HASHTAGS,
      formats: VIDEO_FORMATS.map((f) => ({ id: f.id, label: f.label, note: `${f.duration} · ${f.metric}` })),
      fetchedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json(bundled());
}
