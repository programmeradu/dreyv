/**
 * POST /api/studio/video/draft
 *
 * Stage 3 of the smart Video Studio. Given a chosen creative `direction` and
 * a chosen `hook` (both from the intelligence layer), produce the rest of
 * the production pack: shot list, voiceover, captions, hashtags, sound,
 * posting window, mascot notes.
 *
 * Back-compat: legacy `formatId` / `angle` callers still work — when those
 * are supplied without `direction` we fall back to the original archetype-
 * based prompt path.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { DREYV_DEV_SURFACE } from "@/lib/media-studio/developers-context";
import { videoToolsPrompt, VIDEO_FORMATS, VIDEO_TOOLS, VIDEO_ANGLES } from "@/lib/media-studio/video-tools";
import { chatJson } from "@/lib/media-studio/ai";
import { DREYV_MASCOT_DESCRIPTION, dreyvShotStylePreamble } from "@/lib/media-studio/style-bible";
import {
  buildEvidenceIndex,
  summarizeTikTokPerformance,
  type Direction,
  type HookVariant,
} from "@/lib/media-studio/intelligence";
import { loadTikTokRows } from "@/lib/media-studio/tiktok-store";

export const runtime = "edge";
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
      whyItWorks: { type: "string", description: "2–3 sentences referencing the direction + the data signal we leaned on." },
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

type Body = {
  // New intelligent path
  intent?: string;
  direction?: Direction;
  hook?: HookVariant;
  walletAddress?: string;
  primaryTool?: string;
  trendingSound?: string;
  audience?: string;
  // Legacy path
  formatId?: string;
  angle?: string;
  customAngle?: string;
};

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const primary = body.primaryTool && VIDEO_TOOLS.find((t) => t.id === body.primaryTool);

  // ── INTELLIGENT PATH ────────────────────────────────────────────────────
  if (body.direction && body.hook) {
    const evidence = buildEvidenceIndex({ walletAddress: body.walletAddress ?? null });
    const allowedEvidence = evidence.filter((e) =>
      body.direction!.evidenceRefsUsed.includes(e.id) || e.kind === "capability" || e.kind === "metric",
    );
    const rows = await loadTikTokRows().catch(() => []);
    const digest = rows.length > 0 ? summarizeTikTokPerformance(rows) : null;

    const userPrompt = [
      `Build the full production pack for a TikTok video. The format, length, and hook are LOCKED — your job is to render the rest beautifully and grounded in real evidence.`,
      ``,
      `INTENT (what the video is about): ${body.intent ?? ""}`,
      ``,
      `DIRECTION (locked):`,
      `  Format name: ${body.direction.formatName}`,
      `  Pitch: ${body.direction.oneLiner}`,
      `  Emotional core: ${body.direction.emotionalCore}`,
      `  Duration: ${body.direction.durationSec}s, ${body.direction.shotCount} shots`,
      `  Target comment: ${body.direction.targetComment}`,
      ``,
      `HOOK (locked — use these EXACT lines as the first text card + opener):`,
      `  Text card: ${body.hook.textCard}`,
      `  Spoken opener: ${body.hook.spokenLine}`,
      `  Visual cue: ${body.hook.visualCue}`,
      ``,
      `EVIDENCE — every factual claim in the script MUST map to one of these. If you can't back a claim, drop it:`,
      allowedEvidence.map((e) => `  - [${e.id}] (${e.kind}) ${e.label} — ${e.detail}${e.pointer ? `  ⟶ ${e.pointer}` : ""}`).join("\n"),
      ``,
      digest ? `OUR TIKTOK PERFORMANCE SO FAR (use as priors, do NOT mention on camera):\n${digest.narrative}` : `(No TikTok data connected yet.)`,
      ``,
      primary
        ? `PRIMARY TOOL: ${primary.label}. Prefer it for as many shots as the format allows.`
        : `Pick the best free / low-cost tool for each shot from the catalog. Bias toward Hedra (mascot lip-sync) + Hailuo (B-roll).`,
      body.trendingSound ? `TRENDING SOUND: "${body.trendingSound}". Match its pacing.` : `Suggest a sound or use 'original VO'.`,
      body.audience ? `AUDIENCE: ${body.audience}.` : null,
      ``,
      `OUTPUT REQUIREMENTS:`,
      `- Use the locked hook verbatim in the 'hook' field — do not rewrite it.`,
      `- Shot list: ${body.direction.shotCount} sequential shots that form ONE continuous ad: hook → setup → proof/demo → tension → payoff. Each shot is a new physical state with a new prop, set, or camera angle. No filler "mascot stands on clean background" shots.`,
      `- Each shot must explicitly say what changed since the previous shot and what it hands off to the next shot.`,
      `- Per-shot toolPrompt phrased the way THAT tool expects:`,
      `  • Hedra: motion directive on top of uploaded mascot PNG + audio. No scene generation.`,
      `  • Hailuo / Wan 2.2 / Kling: short dense visual description, 9:16, specify mascot explicitly.`,
      `  • Veo 3 Fast: 5-layer formula [camera/lens] + [lighting/time] + [subject + precise action] + [camera motion] + [mood/sound], 8s max.`,
      `  • Runway Gen-4: cinematic motion trajectories, reference-image friendly.`,
      `- Voiceover: human thinking out loud. Fragments, varied length. Never "Hi everyone, today…".`,
      `- Burned captions: 4–10 short caption cards for mute viewers. Sentence case. No emoji.`,
      `- Hashtags: 5–8 niche + 3 generic. Bias the niche tags toward what worked on our account per the digest above (if available).`,
      `- Sound suggestion: name a trending sound type or "original VO".`,
      `- Posting window in UTC with 1-line reason.`,
      `- Mascot notes: 3–5 bullets on which reference PNG to seed each tool with, lighting lock, camera distance.`,
      `- whyItWorks: tie it back to the direction's emotional core + the strongest data signal we used.`,
      ``,
      `MASCOT (use verbatim wherever the mascot appears in a toolPrompt):`,
      DREYV_MASCOT_DESCRIPTION,
      ``,
      `CINEMATIC STYLE preamble for every video-model toolPrompt:`,
      dreyvShotStylePreamble(),
      ``,
      `HARD DON'TS:`,
      `- No emoji in voiceover, captions, or text card.`,
      `- No greetings or AI-narrator phrasing.`,
      `- Never invent capabilities, partner names, or metrics not in the evidence block.`,
      `- Never describe the mascot as orange, brown, red, or a fox. Solid violet #7c3aed.`,
      `- No floating particles, orbs, holograms, fake dashboards. Clean cinematic frames.`,
      `- No abstract geometry, blank studio voids, or mascot-standing-idle filler.`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const result = await chatJson<Record<string, unknown>>({
        messages: [
          {
            role: "system",
            content:
              "You are dreyv's TikTok video producer. The creative direction and hook were locked by an earlier intelligence pass. Your job is to ground the rest of the pack in real evidence and produce shot prompts that match the locked format exactly.\n\n" +
              videoToolsPrompt(),
          },
          { role: "user", content: userPrompt },
        ],
        schema: SCHEMA,
        temperature: 0.85,
      });
      // Force the locked hook through unchanged in case the model rewrote it.
      (result as { hook: { textCard: string; spokenLine: string } }).hook = {
        textCard: body.hook.textCard,
        spokenLine: body.hook.spokenLine,
      };
      (result as { formatLabel: string }).formatLabel = body.direction.formatName;
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      console.error("[video/draft] intelligent path failed:", message, err);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  // ── LEGACY PATH (kept for back-compat) ──────────────────────────────────
  const format = VIDEO_FORMATS.find((f) => f.id === body.formatId) ?? VIDEO_FORMATS[0];
  const angleId = body.angle ?? VIDEO_ANGLES[0].id;
  const videoAngle = VIDEO_ANGLES.find((a) => a.id === angleId);
  const legacyHook = HERO_HOOKS.find((h) => h.id === angleId);
  const angleText =
    angleId === "custom" && body.customAngle
      ? body.customAngle.trim()
      : videoAngle
      ? `${videoAngle.label}\nTeaser: ${videoAngle.teaser}\nCapabilities to showcase: ${videoAngle.caps}\nCandidate hook lines (riff, don't recite): ${videoAngle.hookIdeas.join(" | ")}`
      : legacyHook
      ? `${legacyHook.title}\nCapabilities: ${legacyHook.caps}\nSafety: ${legacyHook.safety}`
      : `${VIDEO_ANGLES[0].label}\nTeaser: ${VIDEO_ANGLES[0].teaser}`;

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
      ? `PRIMARY TOOL: ${primary.label}.`
      : `Pick the best low-cost tool for each shot.`,
    body.trendingSound ? `TRENDING SOUND: "${body.trendingSound}".` : null,
    body.audience ? `Audience: ${body.audience}.` : null,
    ``,
    `MASCOT (verbatim):`,
    DREYV_MASCOT_DESCRIPTION,
    ``,
    `CINEMATIC STYLE preamble:`,
    dreyvShotStylePreamble(),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await chatJson({
      messages: [
        { role: "system", content: "You are a TikTok video producer.\n\n" + videoToolsPrompt() },
        { role: "user", content: userPrompt },
      ],
      schema: SCHEMA,
      temperature: 0.95,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("[video/draft] legacy path failed:", message, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
