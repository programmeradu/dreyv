/**
 * Canonical Dreyv Video Studio reference: tools, format archetypes, mascot
 * consistency tiers, and the prompt-injection helper used by the generator.
 *
 * Source: docs/marketing/video-tools-research.md +
 *         docs/marketing/tiktok-trends-research.md
 */

export const VIDEO_TOOLS = [
  {
    id: "hedra",
    label: "Hedra Character 3",
    role: "Mascot talking-head + lip-sync",
    free: "Free tier (limited credits)",
    paid: "$15/mo Basic (1,500 credits)",
    consistency: "pixel-perfect",
    api: "https://api.hedra.com/web-app/public",
    prompting:
      "Driven by image + audio, not text. Upload Dreyv mascot PNG (≥512px, clean BG). Pair with ElevenLabs voiceover. Motion directive controls subtle head/body movement.",
  },
  {
    id: "hailuo",
    label: "Hailuo (MiniMax) Standard",
    role: "Action / B-roll, 9:16, mascot via I2V",
    free: "Trial credits only",
    paid: "$7.99/mo promo, $14.99 list — 40 clips/mo",
    consistency: "good (re-seed every clip from original PNG)",
    api: "https://api.minimax.io/v1/video_generation",
    prompting:
      "Short, dense, visually concrete descriptions. Avoid metaphors. 6s on Standard, 10s on Pro. Image-to-video uses uploaded reference as first frame.",
  },
  {
    id: "kling",
    label: "Kling 3.0",
    role: "Multi-shot character scenes with element consistency",
    free: "66 credits/day on web",
    paid: "~$10–29/mo (Standard/Pro)",
    consistency: "strong (Element Consistency Control)",
    api: "https://api.klingai.com/v1/videos/text2video",
    prompting:
      "Behaves like a virtual director. [Shot type] + [Subject + action] + [Emotional context] + [Camera move] + [Audio direction]. Enable element consistency for mascot work.",
  },
  {
    id: "veo3-fast",
    label: "Veo 3 Fast (Gemini API)",
    role: "Cinematic 1080p with native audio when budget allows",
    free: "None on API — use Google Flow consumer (~12 Veo3 Fast clips/mo free)",
    paid: "$0.15/sec API ($1.20 / 8s clip)",
    consistency: "moderate (re-seed via image-to-video each shot)",
    api: "https://generativelanguage.googleapis.com/ (model: veo-003-fast)",
    prompting:
      "5-layer formula: [Camera/lens] + [Lighting/time of day] + [Subject + precise action] + [Camera motion] + [Mood/sound]. 8s max per call.",
  },
  {
    id: "wan22",
    label: "Wan 2.2 (self-hosted)",
    role: "Free unlimited I2V fallback (Apache 2.0)",
    free: "Free weights; ~$0.30–0.80/video on RunPod hosted",
    paid: "Compute cost only",
    consistency: "strong via I2V",
    api: "ComfyUI / RunPod / Replicate",
    prompting:
      "Cinematic motion prompts work well. Mascot PNG as first frame. Describe textures and motion direction explicitly.",
  },
  {
    id: "runway-gen4",
    label: "Runway Gen-4 (Reference mode)",
    role: "Best character lock via uploaded reference images",
    free: "125 one-time credits (~25s Gen-4 Turbo)",
    paid: "$15–35/mo",
    consistency: "best-in-class (Reference mode, up to 4 ref images)",
    api: "https://api.dev.runwayml.com/v1/",
    prompting:
      "Reference image + prompt. Describe motion trajectory, not just scene. 10s max per call.",
  },
] as const;

export type VideoToolId = (typeof VIDEO_TOOLS)[number]["id"];

export const VIDEO_FORMATS = [
  {
    id: "pov",
    label: "POV Immersion",
    duration: "15–30s",
    beats: [
      "0:00–0:02 — text card: 'POV: [relatable situation]'",
      "0:02–0:10 — establish scene, no dialogue",
      "0:10–0:25 — escalation",
      "0:25–0:35 — twist / resolution",
      "0:35–0:41 — loopable ending or CTA",
    ],
    metric: "comments",
    fit: "Mascot-friendly. Hedra lip-sync for opener, Hailuo I2V for scene.",
  },
  {
    id: "til",
    label: "Today Years Old / TIL",
    duration: "15–20s",
    beats: [
      "0:00–0:03 — 'I was today years old when I found out…'",
      "0:03–0:08 — brief context",
      "0:08–0:25 — the revelation, visual demo",
      "0:25–0:35 — 'and apparently this has been true since…'",
      "0:35–0:41 — follow CTA",
    ],
    metric: "shares",
    fit: "Hedra mascot doing a double-take + Wan 2.2 product demo cutaway.",
  },
  {
    id: "skit",
    label: "Skit / Micro-Comedy",
    duration: "15–20s",
    beats: [
      "0:00–0:02 — character + situation, in medias res",
      "0:02–0:10 — recognizable behavior tension",
      "0:10–0:15 — twist / punchline",
      "0:15–0:20 — reaction beat (silence + zoom)",
    ],
    metric: "shares",
    fit: "Hedra for lip-synced dialogue, Kling 3.0 multi-shot for setup→punchline in one gen.",
  },
  {
    id: "explainer",
    label: "Talking-Head Explainer",
    duration: "30–45s",
    beats: [
      "0:00–0:03 — outcome / counterintuitive claim hook",
      "0:03–0:08 — 'here's why this matters to you…'",
      "0:08–0:20 — concept + visual demo",
      "0:20–0:28 — application advice",
      "0:28–0:35 — 'part 2 drops [day]' CTA",
    ],
    metric: "saves",
    fit: "Pure Hedra mascot lip-sync + Hailuo B-roll cutaways.",
  },
  {
    id: "trend-remix",
    label: "Trend Remix (use trending sound)",
    duration: "15–30s",
    beats: [
      "Match the trending audio's pacing",
      "Adapt visual structure to mascot/brand",
      "Insert your twist in the final 5s",
    ],
    metric: "duets",
    fit: "Hailuo or Kling for matching B-roll. Layer mascot via Hedra as cut-in.",
  },
  {
    id: "meme-overlay",
    label: "Meme Overlay (text-driven, mute-friendly)",
    duration: "10–20s",
    beats: [
      "0:00–0:03 — strong visual reaction",
      "TEXT overlay drives the story",
      "0:10–0:20 — escalation via text + reaction",
      "Punchline text + slow zoom",
    ],
    metric: "shares",
    fit: "Hedra (mascot face only, no lip sync) or Pika 'Inflate' on static mascot PNG.",
  },
  {
    id: "before-after",
    label: "Before / After Transformation",
    duration: "15–30s",
    beats: [
      "0:00–0:05 — 'before' state (genuinely bad)",
      "0:05–0:07 — transition / jump cut",
      "0:07–0:15 — 'after' state",
      "0:15–0:30 — optional process reveal",
    ],
    metric: "saves + shares",
    fit: "Wan 2.2 or Hailuo for two contrasting scenes. Add CapCut wipe transition.",
  },
  {
    id: "tutorial",
    label: "Tutorial (show finished result first)",
    duration: "30–60s",
    beats: [
      "0:00–0:03 — reveal end result",
      "0:03–0:15 — step 1",
      "0:15–0:25 — step 2",
      "step N…",
      "last 5s — show result again + 'save this' CTA",
    ],
    metric: "saves",
    fit: "Veo 3 Fast for product demo shots, Hedra mascot framing the steps.",
  },
] as const;

export type VideoFormatId = (typeof VIDEO_FORMATS)[number]["id"];

export const VIRAL_RULES_2026 = [
  "First 1.5s decides algorithm advancement — lead with the thing, not the intro.",
  "Viral median length is 41s — cut ruthlessly, most scripts can lose 30%.",
  "80.2% of viral clips use burned-in animated captions — always.",
  "10.4 hashtags average — 5–8 niche + #fyp #viral #trending.",
  "Best windows: 7am ET or 4pm ET weekdays, Sat 7am.",
  "77.8% of viral clips use third-person framing — narrate, don't star.",
] as const;

export function videoToolsPrompt(): string {
  const tools = VIDEO_TOOLS.map(
    (t) =>
      `  • ${t.label} (${t.id}) — ${t.role}. Free: ${t.free}. Paid: ${t.paid}. Consistency: ${t.consistency}. Prompting: ${t.prompting}`,
  ).join("\n");
  const formats = VIDEO_FORMATS.map(
    (f) =>
      `  • ${f.label} (${f.id}, ${f.duration}, primary metric: ${f.metric}) — Beats:\n${f.beats
        .map((b) => `      - ${b}`)
        .join("\n")}\n      Tool fit: ${f.fit}`,
  ).join("\n");
  const rules = VIRAL_RULES_2026.map((r) => `  - ${r}`).join("\n");
  return [
    "DREYV TIKTOK VIDEO STUDIO CONTEXT (use this when generating video plans):",
    "",
    "Available video tools (free or low-cost; bootstrapped stack):",
    tools,
    "",
    "Format archetypes (pick exactly one and follow its beat structure):",
    formats,
    "",
    "Universal viral rules (2026, OpusClip 13.5M-clip study):",
    rules,
    "",
    "Mascot:",
    "  - Dreyv mascot is the canonical solid-violet owl treasury sentinel with cream face/chest, dark-violet eyes, violet cap, and Dreyv logo marks on cap + chest.",
    "  - Always describe the mascot explicitly in every per-tool prompt, even when reference images are attached.",
    "  - Shot 1 uses canonical mascot references. Later shots continue from the previous shot's tail frames so the ad does not restart.",
    "  - Lock lighting, set logic, camera language, and prop continuity across all clips in the same video.",
    "",
    "Voice / authenticity rules (so output doesn't look AI-cheap):",
    "  - Voiceover script must read like a real human talking, not narration.",
    "  - Use fragments. Vary sentence length. Start sentences with 'And' / 'But' if it sounds right.",
    "  - Specificity over hype — one real prompt example beats three abstract claims.",
    "  - Captions ARE the content for 60% of viewers (sound off). Dreyv burns captions in post; the video model must not render text.",
  ].join("\n");
}

/**
 * TikTok-tuned angles. Concrete, scroll-stopping, mascot-friendly.
 * These replace the generic dev hero hooks in the Video Studio picker —
 * each one is written as the FIRST CARD a viewer would actually see.
 */
export const VIDEO_ANGLES = [
  {
    id: "agent-pays-itself",
    label: "My AI agent paid its own bill",
    teaser: "Funded a USDC wallet, gave Claude the key, watched it pay per API call. No human in the loop.",
    caps: "agent wallet + x402 + prepaid balance + per-call billing",
    hookIdeas: [
      "I gave Claude $20 in USDC and walked away",
      "this AI agent has its own bank account now",
      "watch an agent pay for itself in real time",
    ],
  },
  {
    id: "paste-wallet-story",
    label: "Paste any wallet → Claude tells the story",
    teaser: "Drop a Solana address into Claude. Get the PnL, the rug exposure, the whale moves — in plain English.",
    caps: "wallet intel + portfolio + pnl + risk",
    hookIdeas: [
      "Claude just read this whale's wallet like a diary",
      "paste any SOL address and watch this",
      "I asked Claude what this wallet has been doing. terrifying.",
    ],
  },
  {
    id: "rug-in-3-seconds",
    label: "Is this token a rug? Claude answers in 3 seconds",
    teaser: "Real on-chain forensics — holder concentration, mint authority, liquidity locks — not vibes.",
    caps: "security firewall + risk + holder concentration + mint authority",
    hookIdeas: [
      "this token was a rug and Claude caught it in 3 seconds",
      "stop asking Twitter if it's a rug. ask Claude.",
      "every degen needs this prompt before aping",
    ],
  },
  {
    id: "yield-hunt",
    label: "Best yield on my stables, ranked by risk",
    teaser: "40+ protocols scored by audits, TVL, history. The AI picks. You approve. Non-custodial.",
    caps: "yield + risk-adjusted return + audit status + tvl",
    hookIdeas: [
      "Claude found me 14% on USDC and it's not a Ponzi",
      "I let an AI rank every Solana yield. here's #1",
      "this beats every yield aggregator UI I've used",
    ],
  },
  {
    id: "foresight-sim",
    label: "Simulate a $500k sell before clicking",
    teaser: "Ask Claude what happens if you sell. Get the slippage, the LP drain, the post-trade portfolio.",
    caps: "foresight simulation + market impact + portfolio delta",
    hookIdeas: [
      "I simulated dumping 30% of my bag before doing it",
      "this is what 'check before you click' should feel like",
      "Claude ran the impact model and saved me $40k",
    ],
  },
  {
    id: "mcp-install",
    label: "Install Dreyv MCP in 30 seconds (Claude / Cursor)",
    teaser: "One config line. Suddenly Claude has 300+ web3 tools. No SDK. No keys to manage upfront.",
    caps: "MCP server + tool discovery + Claude/Cursor/ChatGPT compatibility",
    hookIdeas: [
      "your AI agent is one config line away from web3 superpowers",
      "I added 300 tools to Claude in 30 seconds",
      "Cursor + this MCP = unfair advantage",
    ],
  },
  {
    id: "agent-vs-human",
    label: "Agent does treasury ops faster than the CFO",
    teaser: "Payouts, runway, drift detection — the AI ships it before you finish your coffee.",
    caps: "treasury ops + payouts + runway + drift + foresight",
    hookIdeas: [
      "I fired my treasury spreadsheet",
      "the AI closed the books before I sat down",
      "watch Claude run a 6-figure treasury in 90 seconds",
    ],
  },
  {
    id: "non-custodial-magic",
    label: "AI signs nothing. You sign everything. Still magic.",
    teaser: "The misconception that 'AI agents = give up your keys' — debunked with the actual flow.",
    caps: "non-custodial signing + intent layer + user-approved execution",
    hookIdeas: [
      "no, your AI agent doesn't need your seed phrase",
      "the right way to let an agent touch your wallet",
      "this is what non-custodial AI actually looks like",
    ],
  },
  {
    id: "before-after-cli",
    label: "Before/after: 8 dashboards vs one command line",
    teaser: "Birdeye + DexScreener + DeBank + Step + Phantom + … → one prompt.",
    caps: "command bar + unified data + agentic UX",
    hookIdeas: [
      "I closed 8 tabs and opened one prompt",
      "the last crypto dashboard you'll ever need",
      "POV: you stopped tab-hopping",
    ],
  },
  {
    id: "mascot-explains",
    label: "Mascot POV: 'why I exist'",
    teaser: "Dreyv mascot breaks the fourth wall and explains the product in 15 seconds. Pure character bait.",
    caps: "brand + mascot storytelling",
    hookIdeas: [
      "hi. I'm the reason your agent can ship.",
      "I live inside Claude now",
      "POV: you're an AI agent and I just unlocked your hands",
    ],
  },
] as const;

export type VideoAngleId = (typeof VIDEO_ANGLES)[number]["id"];

