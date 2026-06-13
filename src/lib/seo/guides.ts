/**
 * Long-form SEO guides — registry powers programmatic sitemap entries
 * and an internal "more guides" footer block on each guide page.
 */

export type GuideEntry = {
  slug: string;
  title: string;
  description: string;
  /** ISO date — affects datePublished in JSON-LD and freshness sorting. */
  publishedAt: string;
  /** Estimated read time in minutes (shown in header). */
  readMinutes: number;
  /** One-line teaser for the guides hub. */
  teaser: string;
};

export const GUIDES: GuideEntry[] = [
  {
    slug: "intent-driven-treasury-solana",
    title: "Intent-Driven Treasury on Solana",
    description:
      "Why teams move from click-heavy treasury UIs to intent-driven workflows: plan in language, simulate before signing, stay non-custodial.",
    publishedAt: "2026-04-14",
    readMinutes: 8,
    teaser:
      "Plan in language, simulate before signing, stay non-custodial. The case for intent-driven treasury.",
  },
  {
    slug: "solana-dao-treasury-management",
    title: "Solana DAO Treasury Management: 2026 Playbook",
    description:
      "How modern Solana DAOs structure runway, yield, and approvals using multisig vaults, liquid staking, and simulation-first workflows.",
    publishedAt: "2026-04-22",
    readMinutes: 10,
    teaser:
      "Runway buckets, LST yield, Squads approvals, simulation-first signing — the 2026 DAO treasury stack.",
  },
  {
    slug: "squads-multisig-setup-guide",
    title: "Squads Multisig Setup Guide (Solana, v4)",
    description:
      "Step-by-step walkthrough for setting up a Squads v4 multisig vault on Solana — signer policy, thresholds, and connecting to dreyv for simulation.",
    publishedAt: "2026-04-22",
    readMinutes: 9,
    teaser:
      "From zero to a production-ready Squads v4 vault — thresholds, signer hygiene, and dreyv integration.",
  },
  {
    slug: "crypto-treasury-management-solana",
    title: "Crypto Treasury Management on Solana: A 2026 Guide",
    description:
      "How crypto-native teams run treasury management on Solana — non-custodial vaults, yield, accounting, approvals, and AI-driven planning. Built for protocol, DAO, and onchain-company finance leads.",
    publishedAt: "2026-05-10",
    readMinutes: 11,
    teaser:
      "Non-custodial vaults, yield, accounting, approvals, AI planning — the Solana-native crypto treasury stack.",
  },
  {
    slug: "ai-agent-treasury-management",
    title: "AI Agent Treasury Management: Patterns for 2026",
    description:
      "How AI agents are starting to plan, simulate, and propose treasury actions — the architecture, the guardrails, and why simulation-before-signing is non-negotiable.",
    publishedAt: "2026-05-10",
    readMinutes: 9,
    teaser:
      "Plan with an agent, simulate on a fork, sign with humans. The emerging AI treasury pattern.",
  },
  {
    slug: "dca-on-solana-guide",
    title: "Dollar-Cost Averaging on Solana: Programs, Risks, and Setup",
    description:
      "How DCA programs work on Solana via Jupiter and other venues — funding, frequency, slippage controls, and how to run them from a multisig.",
    publishedAt: "2026-04-22",
    readMinutes: 9,
    teaser:
      "DCA from a multisig: funding, frequency, slippage controls, and which venues actually work.",
  },
  {
    slug: "best-solana-multisig-tools",
    title: "Best Solana Multisig Tools in 2026: Squads, Snowflake & the Intelligence Layer",
    description:
      "An honest comparison of the top Solana multisig and treasury tools — Squads v4, Snowflake Safe, Mean Multisig — and where intent-driven intelligence sits on top.",
    publishedAt: "2026-06-13",
    readMinutes: 10,
    teaser:
      "Squads vs Snowflake vs Mean — which multisig fits your team, and why the intelligence layer matters more than the vault.",
  },
  {
    slug: "solana-liquid-staking-treasury",
    title: "Solana Liquid Staking for Treasuries: JitoSOL, mSOL, bSOL Compared",
    description:
      "How Solana treasuries use liquid staking tokens (LSTs) for yield without losing liquidity — JitoSOL, mSOL, bSOL trade-offs, validator risk, and unstake mechanics.",
    publishedAt: "2026-06-13",
    readMinutes: 9,
    teaser:
      "JitoSOL vs mSOL vs bSOL — which LST fits a treasury, and how to size the allocation without breaking runway.",
  },
  {
    slug: "solana-treasury-yield-strategies",
    title: "Solana Treasury Yield Strategies: From USDC Reserves to Onchain Income",
    description:
      "A practical map of yield strategies for Solana treasuries — money markets (Kamino, marginfi, Drift), LSTs, delta-neutral, and where each one breaks.",
    publishedAt: "2026-06-13",
    readMinutes: 11,
    teaser:
      "Money markets, LSTs, delta-neutral — a sober walk through what actually yields for a Solana treasury in 2026.",
  },
  {
    slug: "non-custodial-treasury-explained",
    title: "Non-Custodial Treasury, Explained: Why Keys Should Never Leave Your Wallets",
    description:
      "What non-custodial actually means for an onchain treasury, how it differs from custodial and MPC setups, and what to ask any treasury tool before signing in.",
    publishedAt: "2026-06-13",
    readMinutes: 8,
    teaser:
      "Custodial, MPC, non-custodial — what the words actually mean, and the questions every treasury team should ask.",
  },
  {
    slug: "solana-treasury-accounting-guide",
    title: "Solana Treasury Accounting: Cost Basis, PnL, and Audit Trails",
    description:
      "How to keep clean books for a Solana treasury — cost basis methods, realized vs unrealized PnL, transfers vs swaps, and what auditors actually want to see.",
    publishedAt: "2026-06-13",
    readMinutes: 10,
    teaser:
      "Cost basis, PnL, transfers vs swaps, audit trails — the accounting layer most Solana treasuries skip until it's too late.",
  },
];

export function getGuide(slug: string): GuideEntry | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
