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
    title: "Solana DAO Treasury Management: A 2026 Playbook",
    description:
      "How modern Solana DAOs structure runway, yield, and approvals using multisig vaults, liquid staking, and simulation-first workflows.",
    publishedAt: "2026-04-22",
    readMinutes: 10,
    teaser:
      "Runway buckets, LST yield, Squads approvals, simulation-first signing — the 2026 DAO treasury stack.",
  },
  {
    slug: "squads-multisig-setup-guide",
    title: "Squads Multisig Setup for Solana Treasuries",
    description:
      "Step-by-step walkthrough for setting up a Squads v4 multisig vault on Solana — signer policy, thresholds, and connecting to dreyv for simulation.",
    publishedAt: "2026-04-22",
    readMinutes: 9,
    teaser:
      "From zero to a production-ready Squads v4 vault — thresholds, signer hygiene, and dreyv integration.",
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
];

export function getGuide(slug: string): GuideEntry | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
