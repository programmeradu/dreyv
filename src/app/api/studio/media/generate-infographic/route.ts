/**
 * POST /api/studio/media/generate-infographic
 *
 * Generates a structured infographic *spec* (not pixels) — the UI renders
 * it as a real React component so it stays editable and on-brand.
 *
 * Body: { prompt: string, channel?: Channel }
 * Returns: { spec: InfographicSpec }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { brandSystemPrompt } from "@/lib/media-studio/brand";
import { chatJson } from "@/lib/media-studio/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export type InfographicSpec = {
  title: string;
  subtitle?: string;
  heroStat?: { value: string; label: string };
  bullets: Array<{ label: string; value?: string; detail?: string }>;
  footnote?: string;
  layout: "stat-hero" | "three-pillars" | "comparison" | "timeline";
};

const SCHEMA = {
  name: "dreyv_infographic",
  description: "Structured infographic spec rendered by the Dreyv brand component",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      subtitle: { type: "string" },
      heroStat: {
        type: "object",
        properties: {
          value: { type: "string", description: "Big number / phrase, e.g. '12s' or '93%'" },
          label: { type: "string" },
        },
      },
      bullets: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            detail: { type: "string" },
          },
          required: ["label"],
        },
      },
      footnote: { type: "string" },
      layout: { type: "string", enum: ["stat-hero", "three-pillars", "comparison", "timeline"] },
    },
    required: ["title", "bullets", "layout"],
  },
} as const;

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: { prompt?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  try {
    const spec = await chatJson<InfographicSpec>({
      messages: [
        { role: "system", content: brandSystemPrompt() },
        { role: "user", content: [
          `Generate a Dreyv-branded infographic spec for this brief:`,
          prompt,
          ``,
          `Choose the layout that fits the data.`,
          `Numbers must come from the brief — never invent metrics.`,
          `Keep bullets crisp: label is 2-4 words, detail is one short sentence.`,
        ].join("\n") },
      ],
      schema: SCHEMA,
      temperature: 0.6,
    });
    return NextResponse.json({ spec });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 502 },
    );
  }
}
