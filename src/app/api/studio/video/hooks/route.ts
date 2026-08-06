/**
 * POST /api/studio/video/hooks
 *
 * Stage 2 — given a chosen direction, generate 10 hook variants and score
 * each on scroll-stop / concreteness / watch-through / originality.
 *
 * Body: { intent: string; direction: Direction; walletAddress?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import {
  buildEvidenceIndex,
  generateAndCritiqueHooks,
  summarizeTikTokPerformance,
  type Direction,
} from "@/lib/media-studio/intelligence";
import { loadTikTokRows } from "@/lib/media-studio/tiktok-store";

export const runtime = "edge";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: { intent?: string; direction?: Direction; walletAddress?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.direction || !body.direction.formatName) {
    return NextResponse.json({ error: "Missing 'direction' from /directions output." }, { status: 400 });
  }

  const evidence = buildEvidenceIndex({ walletAddress: body.walletAddress ?? null });
  const rows = await loadTikTokRows().catch(() => []);
  const digest = rows.length > 0 ? summarizeTikTokPerformance(rows) : null;

  try {
    const hooks = await generateAndCritiqueHooks({
      direction: body.direction,
      intent: (body.intent ?? "").trim(),
      evidence,
      tiktokDigest: digest,
    });
    return NextResponse.json({ hooks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hook generation failed";
    console.error("[video/hooks]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
