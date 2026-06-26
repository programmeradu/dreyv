/**
 * Dreyv brand voice + media studio defaults.
 *
 * This file is the single source of truth for how Dreyv talks on social
 * media. Generation routes load these constants into the system prompt so
 * every post sounds like the same product, not a random LLM.
 *
 * Brand research (April 2026):
 *   - Dreyv (pronounced "DRAVE") — agentic treasury OS for Solana-first teams.
 *   - Audience: crypto-native CFOs, DAO ops, founder-operators, DeFi power users.
 *   - Competitors-to-beat in voice: Phantom (delight), Linear (precision),
 *     Vercel (calm authority), Stripe (clarity), Arc (taste).
 *   - Forbidden patterns: emoji-spam, "🚀 LFG", marketing buzzwords
 *     ("revolutionize", "game-changer", "synergy"), gradient cliches in copy.
 */

import { developersContextPrompt } from "./developers-context";


export const DREYV_BRAND = {
  name: "Dreyv",
  pronunciation: "DRAVE",
  tagline: "The agentic treasury OS.",
  oneLiner:
    "Dreyv runs your on-chain treasury — payouts, runway, drift, foresight — through one calm command line.",
  voice: {
    tone: "calm, precise, founder-to-founder; never hype, never emoji-spam",
    person: "first-person plural for product (we), second-person for reader (you)",
    sentences: "short. punchy. fragment when it earns it.",
    forbidden: [
      "🚀", "🔥", "💎", "🤝",
      "revolutionize", "game-changer", "synergy", "disrupt", "next-gen",
      "leverage (as a verb)", "unlock the power of", "supercharge",
    ],
    preferred: [
      "ship", "compounding", "calm", "operator", "runway", "foresight",
      "drift", "directive", "agent", "command",
    ],
  },
  color: { primary: "#7c3aed", primaryName: "violet-600", surface: "#FFFFFF", ink: "#0B0820" },
  font: { display: "Manrope", body: "Manrope" },
  channels: {
    x: { maxChars: 280, threadFriendly: true, hashtagBudget: 0 },
    linkedin: { maxChars: 1300, threadFriendly: false, hashtagBudget: 3 },
    instagram: { maxChars: 2200, threadFriendly: false, hashtagBudget: 5 },
    generic: { maxChars: 600, threadFriendly: false, hashtagBudget: 2 },
  },
} as const;

export type Channel = keyof typeof DREYV_BRAND.channels;
export type AssetKind = "post" | "infographic" | "announcement" | "video";

export function brandSystemPrompt(): string {
  const v = DREYV_BRAND.voice;
  return [
    `You are the in-house brand writer for ${DREYV_BRAND.name} (pronounced "${DREYV_BRAND.pronunciation}").`,
    `Tagline: ${DREYV_BRAND.tagline}`,
    `One-liner: ${DREYV_BRAND.oneLiner}`,
    ``,
    `VOICE`,
    `- Tone: ${v.tone}.`,
    `- Person: ${v.person}.`,
    `- Sentences: ${v.sentences}`,
    `- Never use these: ${v.forbidden.join(", ")}.`,
    `- Prefer this vocabulary when natural: ${v.preferred.join(", ")}.`,
    ``,
    `RULES`,
    `- No emojis unless the channel explicitly is Instagram, and even then max 1.`,
    `- No hashtags on X. Up to 3 on LinkedIn, 5 on Instagram.`,
    `- Never invent metrics, partnerships, or customer logos.`,
    `- If you reference a number, it must come from the user's prompt or be obviously generic ("a few seconds").`,
    `- Output must be ready to publish — no "[insert X]" placeholders.`,
    ``,
    developersContextPrompt(),
  ].join("\n");
}


export function imageStylePrompt(kind: AssetKind): string {
  const base = `Premium fintech brand visual for Dreyv. Solid violet (#7c3aed) accents on a clean white background. Manrope-style typography. Flat, editorial, calm — never gradient-mush or generic SaaS. Subtle violet ambient glow allowed.

STRICT BRAND RULES — DO NOT VIOLATE:
- Do NOT render any Dreyv logo, wordmark, monogram, "D" mark, or the literal word "Dreyv" anywhere in the image. The official logo will be composited separately. Any attempt to draw the brand mark is a failure.
- Do NOT include any text, letters, words, captions, UI chrome, browser frames, terminal windows, or device mockups unless explicitly requested in the subject.
- No fake screenshots, no fake CLI output, no invented product UI.
- Pure abstract / editorial composition only: violet geometry, light, crystal, prism, orbits, gradients of light on white. Subject-driven, never brand-driven.`;

  // Infographics: rich, varied, designed-by-a-master. We randomly pick a
  // creative direction and a layout archetype each call so we don't ship the
  // same Swiss-grid 4-bullet template every time. Brand guardrails stay tight
  // (violet + white + sharp type, no logo, no fake UI), but composition,
  // visual metaphors, charts, and accents have room to breathe.
  const directions = [
    "editorial magazine spread (think Bloomberg Businessweek / The Economist data feature) — confident hierarchy, oversized hero number, real-looking chart or diagram, refined annotations",
    "Pentagram-style poster infographic — one massive typographic statement, minimal supporting marks, tons of whitespace, museum poster energy",
    "Stripe Press / Linear changelog aesthetic — calm density, crisp small caps, thin violet rules, multiple aligned data blocks, premium and quiet",
    "data-driven dashboard frame — abstract chart shapes (sparklines, donut, bar, line) rendered as clean editorial illustrations, not screenshots; numbers are the heroes",
    "isometric diagram — flat-shaded violet geometric shapes (crystals, orbits, stacked planes) illustrating a flow or system, with crisp callouts",
    "annual-report cover meets infographic — strong headline word, layered geometric violet shapes, single hero stat, footnote-style supporting data",
    "minimalist Japanese editorial — extreme negative space, one vertical hero number, tiny precise labels, a single thin violet hairline structuring the page",
    "comparison / before-vs-after split — two columns with contrasting numbers, one anchored in violet, the other in near-black, calm and decisive",
  ];
  const accents = [
    "subtle violet-50 wash blocks behind groups of data",
    "thin violet hairlines as the only structural device",
    "one large abstract violet shape (prism, arc, half-circle) anchoring the composition",
    "small violet glyph marks (dots, ticks, chevrons) used as bullets",
    "one soft violet ambient glow in a corner, otherwise pure white",
    "violet-tinted chart fills with near-black axis labels",
  ];
  const direction = directions[Math.floor(Math.random() * directions.length)];
  const accent = accents[Math.floor(Math.random() * accents.length)];

  const infographicBase = `Premium editorial infographic for Dreyv (an agentic treasury OS for crypto-native founders). This must look designed-by-a-master — Pentagram, Stripe Press, Bloomberg Businessweek, MetaLab caliber. NEVER generic, NEVER template-y, NEVER a flat 4-bullet grid.

CREATIVE DIRECTION FOR THIS PIECE: ${direction}.
ACCENT TREATMENT: ${accent}.

CRAFT BIBLE:
- Treat this as a one-of-a-kind editorial artwork. Vary composition, hierarchy, and visual metaphor every time. No two infographics should look the same.
- Use REAL visual storytelling: charts, diagrams, isometric forms, oversized typography, layered geometry, annotated callouts, sparklines, donut/bar/line abstractions — pick what fits the brief.
- Hierarchy: one undeniable hero element (giant stat, headline phrase, or central diagram), then 2–5 supporting beats. Asymmetric layouts welcome.
- Typography is part of the art: mix scales aggressively (huge display + tiny small-caps labels). Sharp, kerned, perfectly legible — never garbled or fake-letterform.
- Numbers/labels/claims come ONLY from the user brief. Do not invent metrics, logos, or partner names.

BRAND GUARDRAILS (non-negotiable):
- Palette: white (#ffffff) canvas, near-black (#0f0a1f) text, violet-600 (#7c3aed) primary accent, plus violet-100/200/50 for soft tints. Subtle violet-400 ambient glow is allowed if it serves the composition. No other colors.
- No Dreyv logo, no D-monogram, no wordmark lockup. A tiny "DREYV" caption in a corner is fine.
- No people, no stock icons, no emoji, no fake screenshots, no fake CLI output, no device mockups, no gradient mush, no glassmorphism, no 3D photoreal renders.
- Calm, confident, premium. Feels like it took a senior designer days to make.`;

  switch (kind) {
    case "infographic":
      return infographicBase;
    case "announcement":
      return `${base} Announcement key visual: one strong headline word, abstract violet geometry (crystal, prism, orbit), no people, no stock photography.`;
    case "post":
      return `${base} Single-image social post visual: 1 idea, 1 focal element, lots of whitespace, restrained palette.`;
    case "video":
      return `${base} Cinematic motion frame: slow camera, abstract violet light, premium product feel.`;
  }
}
