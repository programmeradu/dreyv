/**
 * POST /api/studio/media/generate-video
 *
 * v1: We don't have a managed video model in the Lovable AI Gateway, so
 * this route returns a *storyboard spec* (scene list + voiceover script +
 * recommended motion direction) that the team uses with our existing
 * videogen pipeline. When a hosted video model is wired in, this route
 * gains a `renderedVideoUrl` without breaking the UI contract.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember, STUDIO_PASS_USER_ID } from "@/lib/media-studio/access";
import { brandSystemPrompt } from "@/lib/media-studio/brand";
import { chatJson } from "@/lib/media-studio/ai";
import { db } from "@/db";
import { mediaStudioAssets } from "@/db/schema";

export const runtime = "nodejs";

function persistedUserId(id: string) {
  return id === STUDIO_PASS_USER_ID ? null : id;
}

function isMigrationPending(err: unknown) {
  return err instanceof Error && err.message.includes("media_studio_assets");
}

const SCHEMA = {
  name: "dreyv_video_storyboard",
  description: "Short-form video storyboard for a Dreyv social clip",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      durationSeconds: { type: "number", description: "5, 10, 15, or 30" },
      aspect: { type: "string", enum: ["9:16", "1:1", "16:9"] },
      scenes: {
        type: "array",
        minItems: 2,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            timeRange: { type: "string", description: "e.g. '0-3s'" },
            visual: { type: "string", description: "What we see — concrete, brand-styled" },
            voiceover: { type: "string", description: "What is said, if anything" },
            onScreenText: { type: "string" },
          },
          required: ["timeRange", "visual"],
        },
      },
      hookLine: { type: "string", description: "First 2 seconds — must stop the scroll" },
      closingCta: { type: "string" },
      music: { type: "string", description: "Genre/mood, e.g. 'minimal ambient with a slow build'" },
    },
    required: ["title", "durationSeconds", "aspect", "scenes", "hookLine", "closingCta"],
  },
} as const;

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: { prompt?: string; durationSeconds?: number; aspect?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  try {
    const spec = await chatJson<Record<string, unknown>>({
      messages: [
        { role: "system", content: brandSystemPrompt() },
        { role: "user", content: [
          `Brief for a Dreyv short-form video:`,
          prompt,
          ``,
          `Target duration: ${body.durationSeconds ?? 15}s. Aspect: ${body.aspect ?? "9:16"}.`,
          `Brand visuals: solid violet on white, abstract geometry, no stock people.`,
          `Hook line must stop the scroll in under 2 seconds.`,
        ].join("\n") },
      ],
      schema: SCHEMA,
      temperature: 0.75,
    });

    let saved = null;
    if (db) {
      try {
        const [row] = await db.insert(mediaStudioAssets).values({
          userId: persistedUserId(gate.user.id),
          kind: "video",
          channel: null,
          title: (spec.title as string) ?? null,
          prompt,
          spec,
          status: "ready",
        }).returning();
        saved = row;
      } catch (err) {
        if (!isMigrationPending(err)) throw err;
      }
    }
    return NextResponse.json({ spec, asset: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Storyboard generation failed" },
      { status: 502 },
    );
  }
}
