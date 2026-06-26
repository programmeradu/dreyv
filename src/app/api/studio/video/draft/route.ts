/**
 * POST /api/studio/video/draft
 *
 * Generates a full TikTok video production pack for the Dreyv mascot.
 *
 * Body: {
 *   formatId: VideoFormatId,         // pov | til | skit | explainer | trend-remix | meme-overlay | before-after | tutorial
 *   angle: string,                    // hero hook id from DREYV_DEV_SURFACE OR "custom"
 *   customAngle?: string,
 *   primaryTool?: VideoToolId,        // forces a primary tool; otherwise model picks best fit
 *   trendingSound?: string,           // sound name from /trends endpoint (optional)
 *   audience?: string,
 * }
 *
 * Returns a per-shot generation pack: hook, shot list, per-tool prompts,
 * voiceover script, captions, hashtags, posting window, mascot notes.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { DREYV_DEV_SURFACE } from "@/lib/media-studio/developers-context";
import { videoToolsPrompt, VIDEO_FORMATS, VIDEO_TOOLS } from "@/lib/media-studio/video-tools";
import { chatJson } from "@/lib/media-studio/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const SCHEMA = {
  name: "dreyv_video_pack",
  description: "A TikTok video production pack for the Dreyv mascot.",
  parameters: {
    type: "object",
    properties: {
      formatLabel: { type: "string" },
      hook: {
        type: "object",
        properties: {
          textCard: { type: "string", description: "On-screen text shown in the first 1.5 seconds." },
          spokenLine: { type: "string", description: "First spoken/voiceover line. Plain conversational." },
        },
        required: ["textCard", "spokenLine"],
      },
      shotList: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "integer" },
            timing: { type: "string", description: "e.g. '0:00–0:03'" },
            description: { type: "string" },
            recommendedTool: { type: "string", description: "Which tool from the catalog runs this shot." },
            toolPrompt: { type: "string", description: "The exact prompt to paste into that tool. Tool-specific phrasing." },
            mascotInShot: { type: "boolean" },
          },
          required: ["n", "timing", "description", "recommendedTool", "toolPrompt", "mascotInShot"],
        },
        minItems: 2,
        maxItems: 8,
      },
      voiceoverScript: {
        type: "string",
        description: "Full voiceover for ElevenLabs → Hedra pipeline. Reads like a real person, not narration.",
      },
      burnedCaptions: {
        type: "array",
        items: { type: "string" },
        description: "Animated captions to burn in (TikTok style, sentence case, no emoji).",
      },
      hashtags: {
        type: "array",
        items: { type: "string" },
        description: "5–8 niche + 3 generic. With the # included.",
      },
      soundSuggestion: { type: "string", description: "Trending sound to pair with, or 'original VO' if not applicable." },
      postingWindow: { type: "string", description: "UTC window + 1-line reason." },
      mascotNotes: {
        type: "array",
        items: { type: "string" },
        description: "Consistency notes — which mascot reference to seed each tool with, lighting lock, etc.",
      },
      whyItWorks: { type: "string", description: "2–3 sentences referencing the viral rules / format archetype." },
    },
    required: [
      "formatLabel",
      "hook",
      "shotList",
      "voiceoverScript",
      "burnedCaptions",
      "hashtags",
      "soundSuggestion",
      "postingWindow",
      "mascotNotes",
      "whyItWorks",
    ],
  },
} as const;

const HERO_HOOKS = DREYV_DEV_SURFACE.heroHooks;

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: {
    formatId?: string;
    angle?: string;
    customAngle?: string;
    primaryTool?: string;
    trendingSound?: string;
    audience?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const format = VIDEO_FORMATS.find((f) => f.id === body.formatId) ?? VIDEO_FORMATS[0];
  const angleId = body.angle ?? "wallet-brain";
  const hook = HERO_HOOKS.find((h) => h.id === angleId);
  const angleText =
    angleId === "custom" && body.customAngle
      ? body.customAngle.trim()
      : hook
      ? `${hook.title}\nCapabilities: ${hook.caps}\nSafety: ${hook.safety}`
      : HERO_HOOKS[0].title;

  const primary = body.primaryTool && VIDEO_TOOLS.find((t) => t.id === body.primaryTool);

  const userPrompt = [
    `Generate a complete TikTok video production pack for the Dreyv mascot.`,
    ``,
    `FORMAT: ${format.label} (${format.id}) — duration ${format.duration}, primary metric ${format.metric}.`,
    `Beat structure to follow EXACTLY:`,
    ...format.beats.map((b) => `  - ${b}`),
    `Tool fit guidance: ${format.fit}`,
    ``,
    `ANGLE / MESSAGE (this is what the video is actually about — riff on it, do not recite it):`,
    angleText,
    ``,
    primary
      ? `PRIMARY TOOL the team has access to: ${primary.label}. Prefer it for as many shots as the format allows. Use other tools only when the primary genuinely can't do that shot type.`
      : `Pick the best free / low-cost tool for each shot from the catalog. Bias toward Hedra (mascot lip-sync) + Hailuo (B-roll) since they're the team's $23/mo stack.`,
    body.trendingSound ? `TRENDING SOUND to build around: "${body.trendingSound}". Match its pacing.` : `No trending sound forced — suggest one or use original VO.`,
    body.audience ? `Audience: ${body.audience}.` : null,
    ``,
    `OUTPUT REQUIREMENTS:`,
    `- Hook: 1 text card (≤8 words, hits in first 1.5s) + 1 spoken opener.`,
    `- Shot list: 3–6 shots. Each has timing, description, recommendedTool (use the tool id from the catalog: hedra | hailuo | kling | veo3-fast | wan22 | runway-gen4), and a toolPrompt phrased the way THAT tool expects.`,
    `  • Hedra prompts describe motion directives on top of an uploaded mascot PNG + audio. No scene generation.`,
    `  • Hailuo / Wan 2.2 / Kling prompts: short dense visual descriptions, 9:16, specify mascot explicitly even with I2V.`,
    `  • Veo 3 Fast prompts: 5-layer formula [camera/lens] + [lighting/time] + [subject + precise action] + [camera motion] + [mood/sound], 8s max.`,
    `  • Runway Gen-4: cinematic motion trajectories, reference-image friendly.`,
    `- Voiceover script: written like a human thinking out loud. Fragments, varied length. NOT "Hi everyone, today we're going to talk about". Lead with the thing.`,
    `- Burned captions: 4–10 short caption cards that drive the story for mute viewers. Sentence case. No emoji.`,
    `- Hashtags: 5–8 niche (crypto / agents / dev-tools / claude / mcp / solana / treasury depending on angle) + 3 generic (#fyp #viral or #foryou).`,
    `- Sound suggestion: name a trending sound type or "original VO".`,
    `- Posting window in UTC with a 1-line reason.`,
    `- Mascot notes: 3–5 bullets on which reference PNG to seed each tool with, lighting lock, camera distance discipline.`,
    `- whyItWorks: cite the format archetype + one viral rule it leans on.`,
    ``,
    `HARD DON'TS:`,
    `- No emoji in voiceover, captions, or text card.`,
    `- No "Hey TikTok!", "In this video we'll…", or any classic AI-narrator phrasing.`,
    `- Never invent capabilities, partner names, or metrics not in the angle block.`,
    `- Never break the mascot description ("orange owl-fox character with amber eyes and russet wing-tips").`,
    `- Don't pitch the dreyv.com app shell — pitch the developer surface (${DREYV_DEV_SURFACE.homepage}, ${DREYV_DEV_SURFACE.mcp}).`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await chatJson({
      messages: [
        {
          role: "system",
          content:
            "You are a TikTok video producer ghost-writing for a bootstrapped founder. You know the 18 viral format archetypes cold and you know which low-cost AI video tool fits each shot. Output reads like a human production plan, not AI slop. Voice over polish.\n\n" +
            videoToolsPrompt(),
        },
        { role: "user", content: userPrompt },
      ],
      schema: SCHEMA,
      temperature: 0.95,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("[video/draft] AI call failed:", message, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
