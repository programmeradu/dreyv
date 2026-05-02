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
import { requireTeamMember, STUDIO_PASS_USER_ID } from "@/lib/media-studio/access";
import { imageStylePrompt, type AssetKind, type Channel } from "@/lib/media-studio/brand";
import { generateImage } from "@/lib/media-studio/ai";
import { putR2Object, presignR2Get, isR2Configured } from "@/lib/agents/artifacts/r2-storage";
import { db } from "@/db";
import { mediaStudioAssets } from "@/db/schema";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const FALLBACK_NOTICE =
  "Image storage is not configured on production yet, so Dreyv returned a lightweight brand preview instead of a raw server error.";

function persistedUserId(id: string) {
  return id === STUDIO_PASS_USER_ID ? null : id;
}

function aspectToSize(a: string | undefined): { w: number; h: number } {
  switch (a) {
    case "16:9": return { w: 1792, h: 1024 };
    case "9:16": return { w: 1024, h: 1792 };
    case "4:5":  return { w: 1024, h: 1280 };
    default:     return { w: 1024, h: 1024 };
  }
}

function fallbackPreviewUrl(title: string | undefined, kind: AssetKind, aspect: string | undefined) {
  const label = (title || `${kind} visual`).slice(0, 64).replace(/[<>&]/g, "");
  const { w, h } = aspectToSize(aspect);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#ffffff"/><circle cx="${Math.round(w * 0.78)}" cy="${Math.round(h * 0.18)}" r="${Math.round(Math.min(w, h) * 0.28)}" fill="#ddd6fe" opacity="0.55"/><circle cx="${Math.round(w * 0.2)}" cy="${Math.round(h * 0.82)}" r="${Math.round(Math.min(w, h) * 0.22)}" fill="#c4b5fd" opacity="0.35"/><path d="M ${Math.round(w * 0.16)} ${Math.round(h * 0.22)} H ${Math.round(w * 0.72)}" stroke="#7c3aed" stroke-width="10" stroke-linecap="round"/><text x="${Math.round(w * 0.16)}" y="${Math.round(h * 0.42)}" fill="#171026" font-family="Arial, sans-serif" font-size="${Math.round(Math.min(w, h) * 0.055)}" font-weight="700">${label}</text><text x="${Math.round(w * 0.16)}" y="${Math.round(h * 0.52)}" fill="#6d5c82" font-family="Arial, sans-serif" font-size="${Math.round(Math.min(w, h) * 0.032)}">Dreyv Media Studio preview</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireTeamMember(req);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    let body: { prompt?: string; kind?: AssetKind; channel?: Channel; aspect?: string; title?: string };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const kind: AssetKind = body.kind ?? "post";
    const { w, h } = aspectToSize(body.aspect);

    if (!isR2Configured()) {
      return NextResponse.json({
        asset: null,
        previewUrl: fallbackPreviewUrl(body.title, kind, body.aspect),
        fallback: true,
        error: FALLBACK_NOTICE,
      });
    }

    const fullPrompt = `${imageStylePrompt(kind)}\n\nSubject: ${prompt}\n\nAspect ratio: ${body.aspect ?? "1:1"}.`;
    const { buffer, mime } = await generateImage({ prompt: fullPrompt });

    const storageKey = `media-studio/${gate.user.id}/${randomUUID()}.png`;
    await putR2Object({ key: storageKey, body: buffer, mime, filename: `dreyv-${kind}.png` });

    const [row] = db
      ? await db.insert(mediaStudioAssets).values({
          userId: persistedUserId(gate.user.id),
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
        }).returning()
      : [null];

    const previewUrl = await presignR2Get({ key: storageKey, filename: `dreyv-${kind}.png`, mime, inline: true });

    return NextResponse.json({ asset: row, previewUrl });
  } catch (err) {
    console.error("[generate-image] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Image generation failed", fallback: true },
      { status: 200 },
    );
  }
}
