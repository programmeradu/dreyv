/**
 * POST /api/studio/reddit/draft
 *
 * Generates a Reddit post draft tuned to a specific subreddit + angle.
 * Body: {
 *   subreddit: string,        // e.g. "ClaudeAI" (no r/ prefix)
 *   angle: string,            // one of HERO_HOOKS ids OR "custom"
 *   customAngle?: string,     // when angle === "custom"
 *   tone?: "founder" | "technical" | "contrarian",
 *   length?: "short" | "medium" | "long",
 *   audience?: string,
 * }
 *
 * Returns: {
 *   titles: string[];          // 1 primary + 3 backups
 *   body: string;              // self-post body, markdown OK
 *   firstComment: string;      // OP's first comment (where the link goes)
 *   postingWindow: string;     // recommended posting time / day
 *   complianceChecks: string[];
 * }
 *
 * No persistence — drafts are copied out of the UI by the team.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { brandSystemPrompt } from "@/lib/media-studio/brand";
import { DREYV_DEV_SURFACE } from "@/lib/media-studio/developers-context";
import { chatJson } from "@/lib/media-studio/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const SCHEMA = {
  name: "dreyv_reddit_draft",
  description: "A subreddit-specific Reddit post draft for Dreyv's MCP/API.",
  parameters: {
    type: "object",
    properties: {
      titles: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 4,
        description: "1 primary + 3 backup titles. No emoji. No clickbait punctuation.",
      },
      body: {
        type: "string",
        description: "Self-post body. Plain text or light markdown. Ends with a question to invite replies.",
      },
      firstComment: {
        type: "string",
        description: "OP's first comment — this is where links live to avoid spam filters.",
      },
      postingWindow: {
        type: "string",
        description: "Recommended day + time window in UTC, with a one-line reason.",
      },
      complianceChecks: {
        type: "array",
        items: { type: "string" },
        description: "Subreddit-specific rule checks the team should re-verify (karma, flair, AI-content stance, self-promo ratio, etc.)",
      },
    },
    required: ["titles", "body", "firstComment", "postingWindow", "complianceChecks"],
  },
} as const;

const HERO_HOOKS = DREYV_DEV_SURFACE.heroHooks;

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: {
    subreddit?: string;
    angle?: string;
    customAngle?: string;
    tone?: "founder" | "technical" | "contrarian";
    length?: "short" | "medium" | "long";
    audience?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subreddit = (body.subreddit ?? "").trim().replace(/^r\//, "");
  if (!subreddit) return NextResponse.json({ error: "subreddit is required" }, { status: 400 });

  const angleId = body.angle ?? "wallet-brain";
  const hook = HERO_HOOKS.find((h) => h.id === angleId);
  const angleText =
    angleId === "custom" && body.customAngle
      ? body.customAngle.trim()
      : hook
      ? `${hook.title}\nCapabilities: ${hook.caps}\nSafety: ${hook.safety}`
      : HERO_HOOKS[0].title;

  const tone = body.tone ?? "founder";
  const length = body.length ?? "medium";
  const lengthGuide =
    length === "short"
      ? "Under 150 words. One tight idea."
      : length === "long"
      ? "500-700 words. Story arc: problem → what I tried → what I built → what worked → ask."
      : "250-400 words. Tight hook, one concrete demo, one ask.";

  const toneGuide =
    tone === "technical"
      ? "Technical-deep. Show the prompt/curl/MCP config. Assume the reader builds with Claude/Cursor."
      : tone === "contrarian"
      ? "Contrarian take. Open with a sharp claim others disagree with. Back it with what you actually shipped."
      : "Founder-casual. First-person, calm, no marketing voice. Like a Show-HN comment, not a press release.";

  const userPrompt = [
    `Target subreddit: r/${subreddit}`,
    `Angle: ${angleText}`,
    `Tone: ${toneGuide}`,
    `Length: ${lengthGuide}`,
    body.audience ? `Audience focus inside the sub: ${body.audience}` : null,
    ``,
    `REDDIT-SPECIFIC RULES:`,
    `- NEVER put a link in the post body. Links live in the OP's first comment only.`,
    `- No UTM parameters. No URL shorteners. Use plain ${DREYV_DEV_SURFACE.homepage} or ${DREYV_DEV_SURFACE.mcp}.`,
    `- No emoji. No hashtags. No "Hey Reddit!" openers.`,
    `- Title under 100 chars. Lowercase or sentence case — not Title Case.`,
    `- The body must include ONE concrete prompt or snippet the reader can paste into Claude/Cursor in 30 seconds.`,
    `- End the body with an open question to invite real replies.`,
    `- The first comment is short (2-4 sentences), credits the sub, and contains the link(s).`,
    `- Apply the safety block where relevant (read-only by default, non-custodial signing, free tier covers testing).`,
    `- If the sub is crypto-skeptical (r/programming, r/SideProject, r/SaaS), lead with the developer-tool angle, not the crypto angle.`,
    `- If the sub is crypto-native (r/solana, r/defi, r/ethdev), lead with the on-chain capability, not generic AI hype.`,
    ``,
    `Generate 1 primary title + 3 backup titles, the body, the first comment with links, a posting-time recommendation in UTC, and a compliance checklist tuned to r/${subreddit}'s known rules.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await chatJson<{
      titles: string[];
      body: string;
      firstComment: string;
      postingWindow: string;
      complianceChecks: string[];
    }>({
      messages: [
        { role: "system", content: brandSystemPrompt() },
        { role: "user", content: userPrompt },
      ],
      schema: SCHEMA,
      temperature: 0.8,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("[reddit/draft] AI call failed:", message, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
