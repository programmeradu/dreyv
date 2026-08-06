/**
 * POST /api/studio/media/generate-copy
 *
 * Generates Dreyv-voiced copy for a post or announcement.
 * Body: { kind: 'post' | 'announcement', channel: 'x'|'linkedin'|'instagram'|'generic',
 *         prompt: string, audience?: string }
 *
 * Returns: { variants: Array<{ headline?: string, body: string, cta?: string }>,
 *            altText: string, suggestedHashtags: string[] }
 *
 * Does NOT persist — the UI calls /api/studio/media/assets to save what's kept.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { brandSystemPrompt, DREYV_BRAND, type Channel, type AssetKind } from "@/lib/media-studio/brand";
import { chatJson } from "@/lib/media-studio/ai";

export const runtime = "edge";
export const maxDuration = 60;

const SCHEMA = {
  name: "dreyv_copy",
  description: "Dreyv-branded social copy variants",
  parameters: {
    type: "object",
    properties: {
      variants: {
        type: "array",
        minItems: 3,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            headline: { type: "string", description: "Optional first-line hook" },
            body: { type: "string", description: "The main copy, ready to publish" },
            cta: { type: "string", description: "Optional closing call-to-action" },
          },
          required: ["body"],
        },
      },
      altText: { type: "string", description: "Accessible alt text describing the post visual" },
      suggestedHashtags: {
        type: "array",
        items: { type: "string" },
        description: "Hashtags WITHOUT the # symbol; respect the channel's budget",
      },
    },
    required: ["variants", "altText", "suggestedHashtags"],
  },
} as const;

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: { kind?: AssetKind; channel?: Channel; prompt?: string; audience?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const kind = body.kind ?? "post";
  const channel: Channel = body.channel ?? "x";
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  const ch = DREYV_BRAND.channels[channel];
  const userPrompt = [
    `Channel: ${channel} (max ~${ch.maxChars} chars per variant, hashtag budget: ${ch.hashtagBudget})`,
    `Asset kind: ${kind}`,
    body.audience ? `Audience focus: ${body.audience}` : null,
    ``,
    `Brief from the team:`,
    prompt,
    ``,
    `Produce 3-4 distinct variants. Vary the angle (founder voice, product-led, contrarian, story).`,
    `Keep every variant under the channel's character limit.`,
    kind === "announcement"
      ? `This is an announcement — open with the news, not a hook.`
      : `This is a regular post — open with a hook, not a label.`,
  ].filter(Boolean).join("\n");

  try {
    const result = await chatJson<{
      variants: Array<{ headline?: string; body: string; cta?: string }>;
      altText: string;
      suggestedHashtags: string[];
    }>({
      messages: [
        { role: "system", content: brandSystemPrompt() },
        { role: "user", content: userPrompt },
      ],
      schema: SCHEMA,
      temperature: 0.85,
    });
    // Trim hashtags to the channel budget
    result.suggestedHashtags = (result.suggestedHashtags ?? []).slice(0, ch.hashtagBudget);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("[generate-copy] AI call failed:", message, err);
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }
}
