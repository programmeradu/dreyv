/**
 * POST /api/studio/media/generate-image
 *
 * Generates a brand-styled image via Lovable AI (Gemini image preview),
 * uploads it to R2, persists a media_studio_assets row, and returns the
 * asset record with a presigned preview URL.
 *
 * Body: { prompt: string, kind: AssetKind, channel?: Channel,
 *         aspect?: '1:1' | '16:9' | '9:16' | '4:5', title?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { imageStylePrompt, type AssetKind, type Channel } from "@/lib/media-studio/brand";
import { generateImage } from "@/lib/media-studio/ai";
import { putR2Object, presignR2Get, isR2Configured } from "@/lib/agents/artifacts/r2-storage";
import { db } from "@/db";
import { mediaStudioAssets } from "@/db/schema";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

function aspectToSize(a: string | undefined): { w: number; h: number } {
  switch (a) {
    case "16:9": return { w: 1792, h: 1024 };
    case "9:16": return { w: 1024, h: 1792 };
    case "4:5":  return { w: 1024, h: 1280 };
    default:     return { w: 1024, h: 1024 };
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 500 });

  let body: { prompt?: string; kind?: AssetKind; channel?: Channel; aspect?: string; title?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  const kind: AssetKind = body.kind ?? "post";
  const { w, h } = aspectToSize(body.aspect);

  const fullPrompt = `${imageStylePrompt(kind)}\n\nSubject: ${prompt}\n\nAspect ratio: ${body.aspect ?? "1:1"}.`;

  try {
    const { buffer, mime } = await generateImage({ prompt: fullPrompt });

    let storageKey: string | null = null;
    if (isR2Configured()) {
      storageKey = `media-studio/${gate.user.id}/${randomUUID()}.png`;
      await putR2Object({ key: storageKey, body: buffer, mime, filename: `dreyv-${kind}.png` });
    }

    const [row] = await db.insert(mediaStudioAssets).values({
      userId: gate.user.id,
      kind,
      channel: body.channel ?? null,
      title: body.title ?? null,
      prompt,
      spec: { aspect: body.aspect ?? "1:1", model: "gemini-3.1-flash-image-preview" },
      storageKey,
      mimeType: mime,
      width: w,
      height: h,
      status: "ready",
    }).returning();

    let previewUrl: string | null = null;
    if (storageKey) {
      previewUrl = await presignR2Get({ key: storageKey, filename: `dreyv-${kind}.png`, mime, inline: true });
    } else {
      // Fallback when R2 is not configured: return inline base64 so the UI still works.
      previewUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    }

    return NextResponse.json({ asset: row, previewUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Image generation failed" },
      { status: 502 },
    );
  }
}
