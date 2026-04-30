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
  ].join("\n");
}

export function imageStylePrompt(kind: AssetKind): string {
  const base = `Premium fintech brand visual for Dreyv. Solid violet (#7c3aed) accents on a clean white background. Manrope-style typography. Flat, editorial, calm — never gradient-mush or generic SaaS. Subtle violet ambient glow allowed.

STRICT BRAND RULES — DO NOT VIOLATE:
- Do NOT render any Dreyv logo, wordmark, monogram, "D" mark, or the literal word "Dreyv" anywhere in the image. The official logo will be composited separately. Any attempt to draw the brand mark is a failure.
- Do NOT include any text, letters, words, captions, UI chrome, browser frames, terminal windows, or device mockups unless explicitly requested in the subject.
- No fake screenshots, no fake CLI output, no invented product UI.
- Pure abstract / editorial composition only: violet geometry, light, crystal, prism, orbits, gradients of light on white. Subject-driven, never brand-driven.`;
  switch (kind) {
    case "infographic":
      return `${base} Infographic layout: clear hierarchy, generous negative space, one bold stat as the hero, supporting labels in small caps. Avoid stock icons.`;
    case "announcement":
      return `${base} Announcement key visual: one strong headline word, abstract violet geometry (crystal, prism, orbit), no people, no stock photography.`;
    case "post":
      return `${base} Single-image social post visual: 1 idea, 1 focal element, lots of whitespace, restrained palette.`;
    case "video":
      return `${base} Cinematic motion frame: slow camera, abstract violet light, premium product feel.`;
  }
}
