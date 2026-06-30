/**
 * Video Studio intelligence layer.
 *
 * Replaces the rigid 8-format / 6-tool dropdown world with a 4-stage engine:
 *
 *   1. Direction Generator  — invents 3 distinct creative directions from a
 *                             single intent string, *not* from a preset list.
 *   2. Hook Foundry         — produces 10 hook variants for the chosen
 *                             direction and runs a critic pass that scores
 *                             scroll-stop, concreteness, watch-through, and
 *                             originality.
 *   3. Evidence Index       — assembles the real dreyv surface (capabilities,
 *                             public routes, screenshot assets, optional
 *                             wallet) so the writer cites *real* things.
 *   4. TikTok Insights      — turns cached TikTok performance into a compact
 *                             "what's working / what's flopping" digest fed
 *                             back into stages 1 & 2.
 *
 * All model calls go through `chatJson` so provider routing (Gemini → Lovable
 * proxy → Lovable direct → others) is preserved.
 */

import { chatJson, type ChatMessage } from "./ai";
import { DREYV_DEV_SURFACE } from "./developers-context";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Direction = {
  id: string;
  formatName: string;
  oneLiner: string;
  emotionalCore: string;
  durationSec: number;
  shotCount: number;
  whyItFitsTikTok: string;
  whyItCouldFlop: string;
  targetComment: string;
  exampleOpener: string;
  evidenceRefsUsed: string[];
};

export type HookVariant = {
  id: string;
  textCard: string;
  spokenLine: string;
  visualCue: string;
  scrollStop: number;     // 0-10
  concreteness: number;   // 0-10
  watchThrough: number;   // 0-10
  originality: number;    // 0-10
  total: number;          // sum/4 → 0-10
  critique: string;
};

export type EvidenceItem = {
  id: string;
  kind: "capability" | "route" | "screenshot" | "wallet" | "metric";
  label: string;
  detail: string;
  // Optional pointer: a public URL or local asset path the script can cite.
  pointer?: string;
};

export type TikTokPerformanceRow = {
  videoId: string;
  caption: string | null;
  postedAt: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  avgWatchSec: number | null;
  fullWatchRate: number | null;
  durationSec: number | null;
  shareUrl: string | null;
};

export type TikTokDigest = {
  videoCount: number;
  totals: { views: number; likes: number; comments: number; shares: number };
  ratios: { likeRate: number; commentRate: number; shareRate: number; avgWatchThrough: number };
  topVideos: Array<Pick<TikTokPerformanceRow, "videoId" | "caption" | "viewCount" | "likeCount" | "fullWatchRate" | "shareUrl">>;
  worstVideos: Array<Pick<TikTokPerformanceRow, "videoId" | "caption" | "viewCount" | "likeCount" | "fullWatchRate" | "shareUrl">>;
  // Plain-English narrative the LLM uses as guidance.
  narrative: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Index — what the script is ALLOWED to cite
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the canonical evidence pool. Anything the writer mentions as a fact
 * ("dreyv has 40+ yield protocols", "you can paste a wallet at /case") must
 * map back to one of these items. The critic pass rejects unsupported claims.
 */
export function buildEvidenceIndex(opts: { walletAddress?: string | null } = {}): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  // Capabilities (real, from the canonical dev surface)
  DREYV_DEV_SURFACE.capabilityFamilies.forEach((family, i) => {
    items.push({
      id: `cap-${i}`,
      kind: "capability",
      label: family.split(" (")[0] ?? family,
      detail: family,
      pointer: DREYV_DEV_SURFACE.restBase,
    });
  });

  // Public routes that exist today
  const ROUTES: Array<[string, string, string]> = [
    ["route-developers", "Developer portal", DREYV_DEV_SURFACE.homepage],
    ["route-mcp", "MCP server endpoint", DREYV_DEV_SURFACE.mcp],
    ["route-openapi", "OpenAPI 3.1 spec", DREYV_DEV_SURFACE.openapi],
    ["route-llms", "llms.txt for agent discovery", DREYV_DEV_SURFACE.llmsTxt],
    ["route-case", "Public counterfactual case reports", "https://dreyv.com/case"],
    ["route-atlas", "Solana Atlas (MEV / rug / DCA)", "https://dreyv.com/atlas"],
    ["route-analytics", "Live analytics workspace", "https://dreyv.com/app/analytics"],
    ["route-pitch", "Investor pitch deck", "https://dreyv.com/pitch"],
  ];
  ROUTES.forEach(([id, label, pointer]) => {
    items.push({ id, kind: "route", label, detail: `Publicly accessible at ${pointer}`, pointer });
  });

  // Real screenshot assets shipped in /public
  const SHOTS: Array<[string, string, string]> = [
    ["shot-dashboard", "Dashboard screenshot", "/screenshots/dashboard.png"],
    ["shot-set-cafe", "Cafe set reference", "/mascot/screens/set-cafe.png"],
    ["shot-set-desk", "Desk set reference", "/mascot/screens/set-desk-environment.png"],
    ["shot-set-night", "Night desk reference", "/mascot/screens/set-desk-night.png"],
    ["shot-set-rooftop", "Rooftop set reference", "/mascot/screens/set-rooftop.png"],
    ["shot-phone", "Phone-in-hand prop", "/mascot/screens/device-phone-in-hand.png"],
    ["shot-laptop", "Blank laptop prop", "/mascot/screens/device-laptop-blank.png"],
  ];
  SHOTS.forEach(([id, label, pointer]) => {
    items.push({ id, kind: "screenshot", label, detail: `Real asset shipped in /public`, pointer });
  });

  // Founder-supplied wallet evidence (opt-in)
  if (opts.walletAddress && opts.walletAddress.trim().length > 0) {
    items.push({
      id: "wallet-founder",
      kind: "wallet",
      label: "Founder wallet activity",
      detail: `Live address: ${opts.walletAddress.trim()}`,
      pointer: `https://dreyv.com/case/${encodeURIComponent(opts.walletAddress.trim())}`,
    });
  }

  // Hard-known marketing metrics (only ones we're comfortable citing on camera)
  items.push({
    id: "metric-free-tier",
    kind: "metric",
    label: "Free tier limit",
    detail: DREYV_DEV_SURFACE.freeTier,
  });

  return items;
}

function evidenceBlock(items: EvidenceItem[]): string {
  return items
    .map((e) => `- [${e.id}] (${e.kind}) ${e.label} — ${e.detail}${e.pointer ? `  ⟶ ${e.pointer}` : ""}`)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — Direction Generator
// ─────────────────────────────────────────────────────────────────────────────

const DIRECTIONS_SCHEMA = {
  name: "dreyv_directions",
  description: "Three distinct creative directions for a single TikTok intent.",
  parameters: {
    type: "object",
    properties: {
      directions: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            formatName: { type: "string", description: "Invent a format name. Do NOT use POV / TIL / skit / explainer." },
            oneLiner: { type: "string", description: "One sentence pitch of the video." },
            emotionalCore: { type: "string", description: "The one emotion that drives the watch — name it concretely." },
            durationSec: { type: "integer", minimum: 8, maximum: 60 },
            shotCount: { type: "integer", minimum: 2, maximum: 8 },
            whyItFitsTikTok: { type: "string" },
            whyItCouldFlop: { type: "string", description: "Be honest about the risk." },
            targetComment: { type: "string", description: "The comment you predict the best viewer will leave." },
            exampleOpener: { type: "string", description: "A draft first spoken line — not the final hook." },
            evidenceRefsUsed: {
              type: "array",
              items: { type: "string" },
              description: "Evidence ids from the provided index that this direction relies on. Use [] if none.",
            },
          },
          required: ["formatName", "oneLiner", "emotionalCore", "durationSec", "shotCount", "whyItFitsTikTok", "whyItCouldFlop", "targetComment", "exampleOpener", "evidenceRefsUsed"],
        },
      },
    },
    required: ["directions"],
  },
} as const;

export async function generateDirections(opts: {
  intent: string;
  audience?: string;
  evidence: EvidenceItem[];
  tiktokDigest?: TikTokDigest | null;
}): Promise<Direction[]> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a TikTok creative director for a bootstrapped Solana / AI-agent developer tool called dreyv. " +
        "Your job is to invent THREE genuinely different creative directions for a single intent. " +
        "Never reach for stock formats (POV, TIL, day-in-the-life, skit, explainer). Invent a fresh format every time. " +
        "Each direction must be renderable with a violet owl-fox mascot and short cinematic shots.",
    },
    {
      role: "user",
      content: [
        `INTENT: ${opts.intent.trim()}`,
        opts.audience ? `AUDIENCE: ${opts.audience.trim()}` : null,
        ``,
        `EVIDENCE INDEX — only cite facts that map to one of these items (use the id):`,
        evidenceBlock(opts.evidence),
        ``,
        opts.tiktokDigest
          ? `WHAT'S ACTUALLY WORKING ON OUR TIKTOK (from real account data):\n${opts.tiktokDigest.narrative}\nUse this to double down on what works and avoid what flops.`
          : `(No TikTok performance data connected yet — propose directions that are inherently testable.)`,
        ``,
        `RULES:`,
        `- 3 directions, each visibly different in shape (length, energy, voice).`,
        `- For each, list the evidence ids you'll lean on. If a direction needs a fact not in the index, drop the fact.`,
        `- No vague "show how AI is the future" angles. Each direction has one concrete moment.`,
        `- Duration is your choice — 8s is fine if the idea is that punchy.`,
      ].filter(Boolean).join("\n"),
    },
  ];

  type Out = { directions: Omit<Direction, "id">[] };
  const out = await chatJson<Out>({
    messages,
    schema: DIRECTIONS_SCHEMA,
    temperature: 0.95,
  });

  return out.directions.map((d, i) => ({ id: `dir-${Date.now()}-${i}`, ...d }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — Hook Foundry (generate 10 → critic scores each)
// ─────────────────────────────────────────────────────────────────────────────

const HOOKS_SCHEMA = {
  name: "dreyv_hooks_scored",
  description: "10 hook variants for a direction, each scored by an internal critic.",
  parameters: {
    type: "object",
    properties: {
      hooks: {
        type: "array",
        minItems: 10,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            textCard: { type: "string", description: "On-screen text, ≤8 words, lands in the first 1.5s." },
            spokenLine: { type: "string", description: "First spoken sentence. Fragments fine. No greetings." },
            visualCue: { type: "string", description: "One concrete physical action / camera move in the first frame." },
            scrollStop: { type: "integer", minimum: 0, maximum: 10 },
            concreteness: { type: "integer", minimum: 0, maximum: 10 },
            watchThrough: { type: "integer", minimum: 0, maximum: 10 },
            originality: { type: "integer", minimum: 0, maximum: 10 },
            critique: { type: "string", description: "1-sentence critic note explaining the score." },
          },
          required: ["textCard", "spokenLine", "visualCue", "scrollStop", "concreteness", "watchThrough", "originality", "critique"],
        },
      },
    },
    required: ["hooks"],
  },
} as const;

export async function generateAndCritiqueHooks(opts: {
  direction: Direction;
  intent: string;
  evidence: EvidenceItem[];
  tiktokDigest?: TikTokDigest | null;
}): Promise<HookVariant[]> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a TikTok hook foundry. You produce 10 hook variants for a given direction, then critique each one as an honest scroll-tester. " +
        "Hooks must work for a violet mascot video. Score harshly — most hooks should be in the 3-6 range; only 1-2 should hit 8+. " +
        "Score dimensions:\n" +
        "  • scrollStop: how likely it stops a finger mid-scroll (pattern interrupt, stakes, curiosity gap).\n" +
        "  • concreteness: contains a real number, wallet, name, screenshot, or specific moment vs vague claims.\n" +
        "  • watchThrough: makes the viewer NEED to see beat 2.\n" +
        "  • originality: avoids 2024 crypto/AI tropes — no 'imagine if', no 'this changes everything', no mascot saying 'hey TikTok'.\n" +
        "Reject AI-narrator phrasing in your critique.",
    },
    {
      role: "user",
      content: [
        `INTENT: ${opts.intent.trim()}`,
        ``,
        `CHOSEN DIRECTION:`,
        `  Format: ${opts.direction.formatName}`,
        `  Pitch: ${opts.direction.oneLiner}`,
        `  Emotional core: ${opts.direction.emotionalCore}`,
        `  Duration: ${opts.direction.durationSec}s, ${opts.direction.shotCount} shots`,
        `  Target comment: ${opts.direction.targetComment}`,
        ``,
        `EVIDENCE THE HOOK CAN REFERENCE (use plain language, not ids in the hook itself):`,
        evidenceBlock(opts.evidence.filter((e) => opts.direction.evidenceRefsUsed.includes(e.id) || e.kind === "capability")),
        ``,
        opts.tiktokDigest
          ? `WHAT WORKED / FLOPPED ON OUR ACCOUNT (use as priors):\n${opts.tiktokDigest.narrative}`
          : `(No account performance data yet.)`,
        ``,
        `Produce exactly 10 hooks. Each must have a different attack angle (do not give me 10 variations of the same line).`,
      ].join("\n"),
    },
  ];

  type Out = { hooks: Array<Omit<HookVariant, "id" | "total">> };
  const out = await chatJson<Out>({
    messages,
    schema: HOOKS_SCHEMA,
    temperature: 0.95,
  });

  return out.hooks.map((h, i) => ({
    id: `hook-${Date.now()}-${i}`,
    ...h,
    total: Math.round(((h.scrollStop + h.concreteness + h.watchThrough + h.originality) / 4) * 10) / 10,
  })).sort((a, b) => b.total - a.total);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4 — TikTok performance digest
// ─────────────────────────────────────────────────────────────────────────────

export function summarizeTikTokPerformance(rows: TikTokPerformanceRow[]): TikTokDigest {
  if (rows.length === 0) {
    return {
      videoCount: 0,
      totals: { views: 0, likes: 0, comments: 0, shares: 0 },
      ratios: { likeRate: 0, commentRate: 0, shareRate: 0, avgWatchThrough: 0 },
      topVideos: [],
      worstVideos: [],
      narrative: "No TikTok videos cached yet. Connect TikTok and click Sync to pull the last 20 videos.",
    };
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.views += r.viewCount;
      acc.likes += r.likeCount;
      acc.comments += r.commentCount;
      acc.shares += r.shareCount;
      return acc;
    },
    { views: 0, likes: 0, comments: 0, shares: 0 },
  );

  const ratios = {
    likeRate: totals.views > 0 ? totals.likes / totals.views : 0,
    commentRate: totals.views > 0 ? totals.comments / totals.views : 0,
    shareRate: totals.views > 0 ? totals.shares / totals.views : 0,
    avgWatchThrough:
      rows.filter((r) => r.fullWatchRate != null).reduce((s, r) => s + (r.fullWatchRate ?? 0), 0) /
      Math.max(1, rows.filter((r) => r.fullWatchRate != null).length),
  };

  const ranked = [...rows].sort((a, b) => b.viewCount - a.viewCount);
  const pick = (r: TikTokPerformanceRow) => ({
    videoId: r.videoId,
    caption: r.caption,
    viewCount: r.viewCount,
    likeCount: r.likeCount,
    fullWatchRate: r.fullWatchRate,
    shareUrl: r.shareUrl,
  });
  const top = ranked.slice(0, 3).map(pick);
  const worst = ranked.slice(-3).reverse().map(pick);

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const lines: string[] = [];
  lines.push(`Across the last ${rows.length} videos: ${totals.views.toLocaleString()} views, ${totals.likes.toLocaleString()} likes (like-rate ${pct(ratios.likeRate)}), avg watch-through ${pct(ratios.avgWatchThrough)}.`);
  if (top.length > 0) {
    lines.push(`Top performer: "${(top[0]?.caption ?? "(no caption)").slice(0, 80)}" — ${top[0]?.viewCount.toLocaleString()} views.`);
  }
  if (worst.length > 0 && worst[0]?.videoId !== top[0]?.videoId) {
    lines.push(`Bottom performer: "${(worst[0]?.caption ?? "(no caption)").slice(0, 80)}" — only ${worst[0]?.viewCount.toLocaleString()} views.`);
  }
  if (ratios.likeRate < 0.02) {
    lines.push(`Like-rate is below the healthy 2–4% band → hooks aren't earning emotional reaction. Bias toward stakes, concrete numbers, and visible payoffs.`);
  }
  if (ratios.avgWatchThrough > 0 && ratios.avgWatchThrough < 0.4) {
    lines.push(`Average watch-through is low → beat 2 is losing them. Tighten the first 3 seconds and front-load the payoff.`);
  }

  return {
    videoCount: rows.length,
    totals,
    ratios,
    topVideos: top,
    worstVideos: worst,
    narrative: lines.join(" "),
  };
}
