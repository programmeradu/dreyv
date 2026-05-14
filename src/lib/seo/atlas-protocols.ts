/**
 * Curated Solana protocol pages for programmatic SEO.
 * Each entry produces /atlas/protocols/[slug] targeting comparison and
 * "what is X" treasury-operator queries (e.g. "kamino vs marginfi", "jito tvl").
 *
 * No live TVL — links to authoritative trackers instead.
 */

export type AtlasProtocol = {
  slug: string;
  name: string;
  category:
    | "dex-aggregator"
    | "amm"
    | "lending"
    | "perps"
    | "liquid-staking"
    | "multisig"
    | "rwa";
  /** <160 char meta description. */
  tagline: string;
  /** 2–3 paragraph overview. */
  overview: string[];
  /** What treasuries actually use this protocol for. */
  treasuryUse: string[];
  /** Honest risks. */
  riskNotes: string[];
  /** Direct competitors for comparison-intent queries. */
  competitors: { name: string; slug?: string; note: string }[];
  /** dreyv intents that touch this protocol. */
  dreyvWorkflows: { label: string; href: string; description: string }[];
  /** Authoritative external links. */
  references: { label: string; href: string }[];
};

export const ATLAS_PROTOCOLS: AtlasProtocol[] = [
  {
    slug: "jupiter",
    name: "Jupiter",
    category: "dex-aggregator",
    tagline:
      "Jupiter is the dominant DEX aggregator on Solana — routing nearly every meaningful swap and DCA flow across the chain's AMMs and CLOBs.",
    overview: [
      "Jupiter aggregates liquidity across every major Solana DEX (Orca, Raydium, Meteora, Phoenix, and more), routing swaps through the path that minimizes price impact. For treasury operators, Jupiter is rarely the destination — it's the routing layer that every swap, DCA, and limit order traverses.",
      "Beyond aggregation, Jupiter ships its own perps venue (Jupiter Perps), a launchpad, a limit-order engine, and the JLP perps liquidity pool.",
      "dreyv uses Jupiter under the hood for every treasury swap — when you ask 'swap 100 SOL to USDC', the planner shows the Jupiter route, expected slippage, and price impact before signing.",
    ],
    treasuryUse: [
      "Best-execution routing for every swap",
      "DCA programs with vault-aware scheduling",
      "Limit orders for exit prices on volatile holdings",
      "JLP exposure for indexed yield",
    ],
    riskNotes: [
      "Aggregator routes through underlying venues — each carries its own smart-contract risk",
      "Concentration of DEX flow on a single aggregator is itself a systemic consideration",
    ],
    competitors: [
      { name: "Direct DEX (Orca, Raydium)", note: "Skips aggregation; only sensible for known-deep pairs." },
      { name: "1inch / Paraswap", note: "EVM-side equivalents; not Solana-native." },
    ],
    dreyvWorkflows: [
      { label: "Swap via Jupiter", href: "/app", description: "Aggregated route with simulated impact preview." },
      { label: "DCA into an asset", href: "/app", description: "Schedule recurring buys with vault-aware execution." },
    ],
    references: [
      { label: "Jupiter docs", href: "https://docs.jup.ag/" },
      { label: "Jupiter Perps", href: "https://jup.ag/perps" },
    ],
  },
  {
    slug: "kamino",
    name: "Kamino Finance",
    category: "lending",
    tagline:
      "Kamino is the largest Solana lending market by TVL — offering supply, borrow, and concentrated-liquidity vaults used by DAOs and protocol treasuries.",
    overview: [
      "Kamino runs Solana's largest lending market and a suite of automated concentrated-liquidity vaults. For treasuries, Kamino is the default destination for supplying USDC, SOL, and LSTs to earn variable APY, or for borrowing stablecoins against SOL/LST collateral.",
      "Kamino's main pool offers cross-margin lending; isolated pools exist for higher-risk assets. The CLMM vaults automate Orca/Raydium concentrated-liquidity positions.",
    ],
    treasuryUse: [
      "Supply idle USDC for lending APY",
      "Use SOL/JitoSOL/mSOL as collateral for stablecoin borrowing",
      "Automated concentrated-liquidity LP without manual range management",
    ],
    riskNotes: [
      "Smart contract risk — sized exposure, never all-in",
      "Utilization spikes can temporarily delay withdrawals",
      "Liquidation risk on collateralized borrowing under stress",
    ],
    competitors: [
      { name: "MarginFi", slug: "marginfi", note: "Cross-margin lending; thinner concentrated-liquidity layer." },
      { name: "Drift Earn", slug: "drift", note: "Lending sourced from perps margin demand." },
    ],
    dreyvWorkflows: [
      { label: "Supply on Kamino", href: "/app", description: "Route USDC or LST supply with simulated APY and utilization." },
      { label: "Compare lending venues", href: "/atlas/strategy-lab", description: "Kamino vs MarginFi vs Drift side-by-side." },
    ],
    references: [
      { label: "Kamino app", href: "https://app.kamino.finance/" },
      { label: "Kamino docs", href: "https://docs.kamino.finance/" },
    ],
  },
  {
    slug: "marginfi",
    name: "MarginFi",
    category: "lending",
    tagline:
      "MarginFi is a cross-margin Solana lending protocol — clean utilization curves and broad asset support for treasury supply and borrow.",
    overview: [
      "MarginFi runs a cross-margin lending market on Solana, where suppliers and borrowers share a single account context across assets. For treasuries, the appeal is predictable utilization curves and a wide list of supported assets including LSTs and stablecoins.",
      "MarginFi competes head-to-head with Kamino on lending. The right choice depends on the asset, current utilization, and whether you want isolated-pool risk segmentation (Kamino) or cross-margin efficiency (MarginFi).",
    ],
    treasuryUse: [
      "Supply USDC, USDT, SOL, JitoSOL, mSOL for lending APY",
      "Borrow against LST collateral",
      "Diversify lending exposure across venues",
    ],
    riskNotes: [
      "Cross-margin means single-account exposure across all positions",
      "Smart contract risk",
      "Liquidation risk on borrowed positions",
    ],
    competitors: [
      { name: "Kamino", slug: "kamino", note: "Larger TVL; isolated-pool option for higher-risk assets." },
      { name: "Drift Earn", slug: "drift", note: "Lending tied to perps margin demand." },
    ],
    dreyvWorkflows: [
      { label: "Supply on MarginFi", href: "/app", description: "Route lending supply with simulated impact." },
      { label: "Audit utilization", href: "/atlas/strategy-lab", description: "Inspect current rates against alternatives." },
    ],
    references: [
      { label: "MarginFi app", href: "https://app.marginfi.com/" },
    ],
  },
  {
    slug: "drift",
    name: "Drift Protocol",
    category: "perps",
    tagline:
      "Drift is a Solana perpetuals exchange with a built-in lending and earn layer — used by treasuries for hedging and stablecoin yield.",
    overview: [
      "Drift is Solana's leading on-chain perps venue, with cross-margin accounts that combine perpetuals trading, spot lending, and a borrowing layer. For treasuries, Drift's main draw is the Earn layer (USDC supply yield sourced from perps margin demand) and the ability to hedge directional SOL exposure without leaving Solana.",
    ],
    treasuryUse: [
      "USDC Earn yield from perps borrowers",
      "Hedge SOL exposure with perpetual shorts",
      "Cross-margin collateral for hedged strategies",
    ],
    riskNotes: [
      "Perps account risk — cross-margin can compound losses",
      "Smart contract risk",
      "Funding rate risk on hedged positions",
    ],
    competitors: [
      { name: "Jupiter Perps", slug: "jupiter", note: "LP-counterparty model (JLP) vs Drift's order-book." },
      { name: "Mango Markets", note: "Less active; historically order-book-driven." },
    ],
    dreyvWorkflows: [
      { label: "Supply USDC to Drift Earn", href: "/app", description: "Route supply with simulated APY." },
      { label: "Hedge SOL exposure", href: "/app", description: "Plan a perpetual short with funding-rate projection." },
    ],
    references: [
      { label: "Drift app", href: "https://app.drift.trade/" },
      { label: "Drift docs", href: "https://docs.drift.trade/" },
    ],
  },
  {
    slug: "marinade",
    name: "Marinade Finance",
    category: "liquid-staking",
    tagline:
      "Marinade is Solana's longest-running liquid staking protocol — issuing mSOL backed by stake spread across hundreds of decentralization-vetted validators.",
    overview: [
      "Marinade issues mSOL, a liquid staking token backed by SOL auto-delegated across a wide validator set selected for performance and decentralization. Treasuries that prioritize validator decentralization over MEV-enhanced yield typically choose mSOL over JitoSOL.",
      "Marinade also offers Marinade Native — direct stake to the same vetted validator set without the LST layer, for treasuries that don't need composability.",
    ],
    treasuryUse: [
      "Liquid SOL exposure with decentralization-aligned validator set",
      "mSOL as collateral on Kamino, MarginFi, Drift",
      "Marinade Native for direct stake without LST risk",
    ],
    riskNotes: [
      "Smart contract risk on the staking pool",
      "Instant unstake fees during stress conditions",
      "LST/SOL ratio fluctuation",
    ],
    competitors: [
      { name: "Jito (JitoSOL)", slug: "jito", note: "MEV-aware yield, often 1–2% above mSOL." },
      { name: "Native delegation", note: "Full validator control, no LST liquidity." },
    ],
    dreyvWorkflows: [
      { label: "Stake into mSOL", href: "/app", description: "One-click route with Squads multisig approval." },
      { label: "Compare LSTs", href: "/atlas/strategy-lab", description: "Marinade vs Jito vs native side-by-side." },
    ],
    references: [
      { label: "Marinade docs", href: "https://docs.marinade.finance/" },
    ],
  },
  {
    slug: "jito",
    name: "Jito",
    category: "liquid-staking",
    tagline:
      "Jito runs the dominant MEV-aware Solana validator client and issues JitoSOL — the LST that captures and redistributes MEV tips to stakers.",
    overview: [
      "Jito's validator client captures MEV (maximal extractable value) and redistributes the tips to JitoSOL holders. For treasuries optimizing yield on SOL exposure, JitoSOL has historically led the LST pack by 1–2% over decentralization-first peers.",
      "Jito is also a major contributor to the Solana validator software ecosystem, and JitoSOL is widely accepted as collateral across Solana DeFi.",
    ],
    treasuryUse: [
      "MEV-enhanced liquid staking yield",
      "JitoSOL as collateral on Kamino, MarginFi, Drift",
      "LP base for JitoSOL/SOL pools",
    ],
    riskNotes: [
      "Smart contract risk on the staking pool",
      "Validator set centralization considerations vs Marinade",
      "MEV yield is variable, not guaranteed",
    ],
    competitors: [
      { name: "Marinade (mSOL)", slug: "marinade", note: "Decentralization-first, no MEV layer." },
      { name: "Native delegation", note: "Full control, no LST." },
    ],
    dreyvWorkflows: [
      { label: "Stake into JitoSOL", href: "/app", description: "Compare against mSOL and native before signing." },
      { label: "Project staking yield", href: "/atlas/strategy-lab", description: "Forecast yield + MEV at variable SOL price." },
    ],
    references: [
      { label: "Jito docs", href: "https://docs.jito.network/" },
    ],
  },
  {
    slug: "squads",
    name: "Squads Protocol",
    category: "multisig",
    tagline:
      "Squads is the standard Solana multisig — used by DAOs, protocol teams, and on-chain treasuries to enforce M-of-N approval on every signed transaction.",
    overview: [
      "Squads (v4) is the dominant multisig program on Solana. It provides M-of-N signing accounts, programmable transaction approval, and a vault model that holds assets behind multi-party authorization.",
      "For any treasury managing meaningful capital on Solana, a Squads vault is the floor — single-signer hot wallets are not a treasury, they're a single point of failure waiting to happen.",
      "dreyv routes every state-changing transaction through your Squads vault. The simulation runs first, then the proposal lands in Squads for the configured approver set to review and sign.",
    ],
    treasuryUse: [
      "Custody all treasury assets behind M-of-N approval",
      "Programmable approval rules for spend ceilings and asset gates",
      "Audit trail for every signed transaction",
    ],
    riskNotes: [
      "Smart contract risk on the multisig program",
      "Operational risk if signer keys are mismanaged",
      "Bus-factor risk if M is set too low or signers are concentrated",
    ],
    competitors: [
      { name: "Realms (SPL Governance)", note: "DAO-governance focused; heavier process for ops-grade signing." },
      { name: "Goki", note: "Earlier-generation multisig; less active development." },
    ],
    dreyvWorkflows: [
      { label: "Route via Squads", href: "/app", description: "Every plan lands as a Squads proposal after simulation." },
      { label: "Squads setup guide", href: "/guides/squads-multisig-setup-guide", description: "Walkthrough for spinning up a treasury-grade multisig." },
    ],
    references: [
      { label: "Squads docs", href: "https://docs.squads.so/" },
    ],
  },
];

export function getProtocol(slug: string): AtlasProtocol | undefined {
  const lower = slug.toLowerCase();
  return ATLAS_PROTOCOLS.find((p) => p.slug === lower);
}

export function getAllProtocolSlugs(): string[] {
  return ATLAS_PROTOCOLS.map((p) => p.slug);
}
