import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { brandSystemPrompt } from "@/lib/media-studio/brand";
import { chatJson } from "@/lib/media-studio/ai";
import type { ContentSuggestion } from "@/lib/media-studio/types";

export const runtime = "nodejs";

const FALLBACK_SUGGESTIONS: ContentSuggestion[] = [
  {
    id: "runway-drift",
    kind: "post",
    channel: "x",
    title: "Runway drift is silent until it is not",
    brief: "Write a sharp X post for crypto-native founders about treasury drift: stablecoin runway changes, token volatility, and why Dreyv turns drift into a directive before it becomes a meeting.",
    audience: "crypto founders",
    aspect: "1:1",
  },
  {
    id: "foresight-card",
    kind: "infographic",
    channel: "linkedin",
    title: "From balance sheet to next move",
    brief: "Create an infographic showing Dreyv's treasury operating loop: observe balances, detect drift, forecast runway, propose a directive, execute through multisig. Do not invent metrics.",
    audience: "DAO operators and CFOs",
    aspect: "4:5",
  },
  {
    id: "atlas-announcement",
    kind: "announcement",
    channel: "linkedin",
    title: "Atlas as the read-only front door",
    brief: "Draft a launch-style announcement for Atlas: a read-only Solana treasury intelligence surface for comparing tokens, routes, and risk before connecting a wallet.",
    audience: "Solana teams",
    aspect: "16:9",
  },
  {
    id: "command-video",
    kind: "video",
    channel: "x",
    title: "One calm command",
    brief: "Storyboard a short motion post showing a founder moving from spreadsheet anxiety to one Dreyv command that explains runway, drift, and the next treasury directive.",
    audience: "founder-operators",
    aspect: "9:16",
    durationSeconds: 15,
  },
];

const SCHEMA = {
  name: "dreyv_content_suggestions",
  description: "Ready-to-run Dreyv Media Studio content suggestions",
  parameters: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["post", "infographic", "announcement", "video"] },
            channel: { type: "string", enum: ["x", "linkedin", "instagram", "generic"] },
            title: { type: "string" },
            brief: { type: "string" },
            audience: { type: "string" },
            aspect: { type: "string", enum: ["1:1", "16:9", "9:16", "4:5"] },
            durationSeconds: { type: "number" },
          },
          required: ["id", "kind", "channel", "title", "brief"],
        },
      },
    },
    required: ["suggestions"],
  },
} as const;

export async function GET(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const result = await chatJson<{ suggestions: ContentSuggestion[] }>({
      messages: [
        { role: "system", content: brandSystemPrompt() },
        {
          role: "user",
          content: [
            "Generate ready-to-run content suggestions for Dreyv's internal Media Studio.",
            "Cover: X/LinkedIn post copy, infographics, announcement visuals, and short video storyboards.",
            "Use current evergreen Dreyv product themes only: treasury command layer, runway, drift, foresight, Atlas, multisig-native execution, founder operators.",
            "Do not invent customer names, partnerships, or numeric performance claims.",
            "Each brief must be specific enough that the next generation step needs no extra user input.",
          ].join("\n"),
        },
      ],
      schema: SCHEMA,
      temperature: 0.8,
    });
    return NextResponse.json({ suggestions: result.suggestions?.length ? result.suggestions : FALLBACK_SUGGESTIONS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate suggestions";
    const status = message.includes("429") ? 429 : message.includes("402") ? 402 : 200;
    return NextResponse.json({ suggestions: FALLBACK_SUGGESTIONS, fallback: true, error: message }, { status });
  }
}
