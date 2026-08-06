/**
 * POST /api/studio/media/generate-infographic
 *
 * Generates a brand-styled infographic *image* via Lovable AI (Nano Banana Pro
 * / google/gemini-3-pro-image-preview). The route mirrors generate-image:
 * persists the PNG to R2 + media_studio_assets, returns the asset row plus a
 * presigned previewUrl. The previous spec-based JSON renderer was replaced
 * because hand-built React/SVG infographics looked too template-y.
 *
 * Body: { prompt: string, channel?: Channel, aspect?: '1:1'|'4:5'|'16:9'|'9:16', title?: string }
 * Returns: { asset, previewUrl, fallback?, error? }
 */

import { NextRequest, NextResponse } from "next/server";
import type { AssetKind, Channel } from "@/lib/media-studio/brand";

export const runtime = "edge";
export const maxDuration = 120; // Pro image model can be slow

const FALLBACK_NOTICE =
  "Image storage is not configured on production yet, so Dreyv returned a lightweight brand preview instead of a raw server error.";

// Nano Banana Pro — best legibility for typography-heavy infographics.
const INFOGRAPHIC_MODEL = "google/gemini-3-pro-image-preview";

function aspectToSize(a: string | undefined): { w: number; h: number } {
  switch (a) {
    case "16:9": return { w: 1792, h: 1024 };
    case "9:16": return { w: 1024, h: 1792 };
    case "4:5":  return { w: 1024, h: 1280 };
    default:     return { w: 1024, h: 1024 };
  }
}

function fallbackPreviewUrl(title: string | undefined, aspect: string | undefined) {
  const label = (title || "Dreyv infographic").slice(0, 64).replace(/[<>&]/g, "");
  const { w, h } = aspectToSize(aspect);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#ffffff"/><circle cx="${Math.round(w * 0.78)}" cy="${Math.round(h * 0.18)}" r="${Math.round(Math.min(w, h) * 0.28)}" fill="#ddd6fe" opacity="0.55"/><circle cx="${Math.round(w * 0.2)}" cy="${Math.round(h * 0.82)}" r="${Math.round(Math.min(w, h) * 0.22)}" fill="#c4b5fd" opacity="0.35"/><path d="M ${Math.round(w * 0.16)} ${Math.round(h * 0.22)} H ${Math.round(w * 0.72)}" stroke="#7c3aed" stroke-width="10" stroke-linecap="round"/><text x="${Math.round(w * 0.16)}" y="${Math.round(h * 0.42)}" fill="#171026" font-family="Arial, sans-serif" font-size="${Math.round(Math.min(w, h) * 0.055)}" font-weight="700">${label}</text><text x="${Math.round(w * 0.16)}" y="${Math.round(h * 0.52)}" fill="#6d5c82" font-family="Arial, sans-serif" font-size="${Math.round(Math.min(w, h) * 0.032)}">Dreyv Media Studio preview</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function POST(req: NextRequest) {
  let body: { prompt?: string; channel?: Channel; aspect?: string; title?: string } = {};
  try {
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const [
      { requireTeamMember, STUDIO_PASS_USER_ID },
      { imageStylePrompt },
      { generateImage },
      { putR2Object, presignR2Get, isR2Configured },
      dbModule,
      schemaModule,
      cryptoModule,
    ] = await Promise.all([
      import("@/lib/media-studio/access"),
      import("@/lib/media-studio/brand"),
      import("@/lib/media-studio/ai"),
      import("@/lib/agents/artifacts/r2-storage"),
      import("@/db"),
      import("@/db/schema"),
      import("crypto"),
    ]);

    const gate = await requireTeamMember(req);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const prompt = (body.prompt ?? "").trim();
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const kind: AssetKind = "infographic";
    const aspect = body.aspect ?? "1:1";
    const { w, h } = aspectToSize(aspect);

    if (!isR2Configured()) {
      return NextResponse.json({
        asset: null,
        previewUrl: fallbackPreviewUrl(body.title, aspect),
        fallback: true,
        error: FALLBACK_NOTICE,
      });
    }

    const fullPrompt = [
      imageStylePrompt(kind),
      "",
      `BRIEF FROM THE USER (source of truth — every number, label, and claim must come from here; do not invent):`,
      prompt,
      "",
      `INTERPRETATION:`,
      `- Pick the single most powerful visual metaphor for this brief and commit to it. Do NOT default to a 4-bullet grid.`,
      `- If the brief implies change over time → use a chart or timeline.`,
      `- If it implies comparison → use a split / before-vs-after composition.`,
      `- If it implies a system or flow → use an isometric or diagrammatic illustration.`,
      `- If it implies a single dramatic stat → make that number the entire hero, poster-style.`,
      `- Surprise the viewer with composition while staying perfectly on-brand.`,
      "",
      `Output: a single self-contained editorial infographic image at aspect ratio ${aspect}. All text rendered crisply with sharp letterforms — no garbled type, no placeholder lorem-ipsum, no fake-language text.`,
    ].join("\n");

    const { buffer, mime } = await generateImage({ prompt: fullPrompt, model: INFOGRAPHIC_MODEL });

    const storageKey = `media-studio/${gate.user.id}/${cryptoModule.randomUUID()}.png`;
    await putR2Object({ key: storageKey, body: buffer, mime, filename: `dreyv-infographic.png` });

    const db = dbModule.db;
    const persistedUserId = gate.user.id === STUDIO_PASS_USER_ID ? null : gate.user.id;
    const [row] = db
      ? await db.insert(schemaModule.mediaStudioAssets).values({
          userId: persistedUserId,
          kind,
          channel: body.channel ?? null,
          title: body.title ?? null,
          prompt,
          spec: { aspect, model: INFOGRAPHIC_MODEL },
          storageKey,
          mimeType: mime,
          width: w,
          height: h,
          status: "ready",
        }).returning()
      : [null];

    const previewUrl = await presignR2Get({ key: storageKey, filename: `dreyv-infographic.png`, mime, inline: true });

    return NextResponse.json({ asset: row, previewUrl });
  } catch (err) {
    console.error("[generate-infographic] failed", err);
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : "Infographic generation failed";
    return NextResponse.json(
      {
        asset: null,
        previewUrl: fallbackPreviewUrl(body.title, body.aspect),
        fallback: true,
        error: msg,
      },
      { status: 200 },
    );
  }
}
