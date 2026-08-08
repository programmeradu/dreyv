export const runtime = "edge";
/**
 * POST /api/studio/video/directions
 *
 * Stage 1 of the smart Video Studio. Takes a free-text intent and returns 3
 * invented creative directions — no preset formats. The user picks one and
 * passes it to /hooks.
 *
 * Body: { intent: string; audience?: string; walletAddress?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { buildEvidenceIndex, generateDirections, summarizeTikTokPerformance } from "@/lib/media-studio/intelligence";
import { loadTikTokRows } from "@/lib/media-studio/tiktok-store";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: { intent?: string; audience?: string; walletAddress?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const intent = (body.intent ?? "").trim();
  if (intent.length < 4) {
    return NextResponse.json({ error: "Tell me what the video is actually about (at least a few words)." }, { status: 400 });
  }

  const evidence = buildEvidenceIndex({ walletAddress: body.walletAddress ?? null });
  const rows = await loadTikTokRows().catch(() => []);
  const digest = rows.length > 0 ? summarizeTikTokPerformance(rows) : null;

  try {
    const directions = await generateDirections({
      intent,
      audience: body.audience,
      evidence,
      tiktokDigest: digest,
    });
    return NextResponse.json({ directions, evidence, tiktokDigest: digest });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Direction generation failed";
    console.error("[video/directions]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
