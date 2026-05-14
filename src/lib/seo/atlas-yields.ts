/**
 * Curated yield-asset pages for programmatic SEO.
 * Each entry produces /atlas/yields/[asset] targeting "best <asset> yield solana"
 * and similar treasury-operator queries.
 *
 * No live APYs — those rot. Frame venues, mechanics, and treasury fit.
 */

export type AtlasYieldVenue = {
  name: string;
  kind: "lending" | "lst" | "lp" | "perps-lp" | "stablecoin-vault";
  href: string;
  notes: string;
};

export type AtlasYieldAsset = {
  slug: string;
  symbol: string;
  name: string;
  /** <160 char meta description. */
  tagline: string;
  /** 2–3 paragraph overview. */
  overview: string[];
  /** What "yield" actually means for this asset. */
  yieldShape: string[];
  /** Curated venues — vetted, not exhaustive. */
  venues: AtlasYieldVenue[];
  /** When this asset is and isn't a fit for a treasury. */
  treasuryFit: { good: string[]; bad: string[] };
  /** Honest risks. */
  riskNotes: string[];
  /** dreyv intents that touch this asset. */
  dreyvWorkflows: { label: string; href: string; description: string }[];
};

export const ATLAS_YIELD_ASSETS: AtlasYieldAsset[] = [
  {
    slug: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    tagline:
      "Best USDC yield options on Solana — lending markets, stablecoin vaults, and perps LP — sized for treasury operators.",
    overview: [
      "USDC is the working-capital asset of most Solana treasuries. Once operating runway is sized, the surplus is the question — park it idle (zero yield, full liquidity) or route it through a vetted yield venue (single-digit APY, smart-contract risk).",
      "On Solana, USDC yield comes from three primary sources: variable-rate lending markets (Kamino, MarginFi, Drift), perps liquidity pools (JLP, Drift's BAL), and stablecoin LP positions on AMMs.",
      "dreyv's role is to surface APY, TVL, utilization, and exit liquidity side-by-side — and route the deposit through your multisig with a simulated impact preview before you sign.",
    ],
    yieldShape: [
      "Variable supply APY on lending markets, driven by borrow demand",
      "Perps-LP yield (JLP) — counterparty to leveraged traders, paid in fees",
      "AMM LP yield on stable/stable pairs — small spread + emissions",
    ],
    venues: [
      { name: "Kamino Lend", kind: "lending", href: "https://app.kamino.finance/", notes: "Largest Solana lending market by TVL; isolated and main pools." },
      { name: "MarginFi", kind: "lending", href: "https://app.marginfi.com/", notes: "Cross-margin lending with predictable utilization curves." },
      { name: "Drift Earn", kind: "lending", href: "https://app.drift.trade/", notes: "Lending sourced from perps margin demand." },
      { name: "JLP (Jupiter Perps LP)", kind: "perps-lp", href: "https://jup.ag/perps-earn", notes: "Counterparty to perps traders; index of SOL/ETH/BTC + USDC/USDT." },
    ],
    treasuryFit: {
      good: [
        "DAOs holding 6–18 months of operating runway in stables",
        "Protocol treasuries that can wear smart-contract risk on a sized portion",
        "Teams with multisig + monitoring already in place",
      ],
      bad: [
        "Working float that may be drawn within the week — keep that idle",
        "Treasuries without a written exit plan if a venue freezes withdrawals",
      ],
    },
    riskNotes: [
      "Smart contract risk on every venue — always sized, never all-in",
      "Utilization spikes can delay withdrawals on lending markets",
      "JLP carries directional exposure to the underlying basket",
      "Issuer (Circle) risk on USDC itself",
    ],
    dreyvWorkflows: [
      { label: "Park idle USDC", href: "/app", description: "Surface vetted venues with current APY, TVL, and utilization." },
      { label: "Compare venues", href: "/atlas/strategy-lab", description: "Side-by-side projection across lending and perps LP." },
      { label: "Audit a venue", href: "/app", description: "Inspect TVL history, mint authority, freeze risk before depositing." },
    ],
  },
  {
    slug: "sol",
    symbol: "SOL",
    name: "Solana",
    tagline:
      "How treasuries earn yield on SOL — native staking, liquid staking (JitoSOL, mSOL), and SOL-collateralized lending — without giving up custody.",
    overview: [
      "Idle SOL in a multisig is collecting fees but not yield. The standard treasury response is to stake — either natively (you pick the validator), via a liquid staking token (you keep liquidity), or by routing into a SOL-collateralized lending position.",
      "Yield on SOL is dominated by two engines: validator inflation rewards (~5–7% baseline) and MEV redistribution (variable, captured by Jito-aware LSTs).",
      "dreyv compares Jito vs Marinade vs native delegation in the planning step, with the unstake mechanics and fee schedules surfaced before you sign.",
    ],
    yieldShape: [
      "Inflation + transaction fees redistributed to validators and stakers",
      "MEV tips captured by Jito-aware validators and shared with stakers",
      "Lending supply APY when SOL is supplied as collateral on Kamino / MarginFi",
    ],
    venues: [
      { name: "JitoSOL", kind: "lst", href: "https://www.jito.network/staking/", notes: "MEV-aware liquid staking; historically 1–2% above vanilla staking." },
      { name: "mSOL (Marinade)", kind: "lst", href: "https://marinade.finance/", notes: "Decentralization-first liquid staking across hundreds of validators." },
      { name: "Native delegation", kind: "lst", href: "https://docs.solana.com/staking", notes: "Direct delegation — full control of validator choice, no LST risk." },
      { name: "Kamino SOL lending", kind: "lending", href: "https://app.kamino.finance/", notes: "Supply SOL or LSTs as collateral, earn lending APY." },
    ],
    treasuryFit: {
      good: [
        "Long-horizon SOL holdings that don't need same-block liquidity",
        "Treasuries comfortable holding LSTs as a custody primitive",
      ],
      bad: [
        "Operational SOL float used for fees and signing — keep liquid",
        "Treasuries with no slashing tolerance — direct stake to a vetted set instead",
      ],
    },
    riskNotes: [
      "Slashing risk on direct delegation (low historically, non-zero)",
      "LST de-peg risk under stress (LST/SOL ratio can drift)",
      "Smart contract risk on liquid staking pools",
      "Network outage history — keep operational float liquid",
    ],
    dreyvWorkflows: [
      { label: "Stake SOL", href: "/app", description: "Compare Jito vs Marinade vs native with simulated fees and unstake timing." },
      { label: "Project staking yield", href: "/atlas/strategy-lab", description: "Forecast yield + MEV at variable SOL price." },
      { label: "Unstake LST", href: "/app", description: "Choose instant (with fee) or epoch-delayed redemption." },
    ],
  },
  {
    slug: "msol",
    symbol: "mSOL",
    name: "Marinade Staked SOL",
    tagline:
      "mSOL yield strategies for Solana treasuries — base staking yield plus DeFi composability across Kamino, Drift, and AMM pools.",
    overview: [
      "mSOL is already a yield-bearing asset (the base staking yield accrues into the redemption ratio). The treasury question is whether to stack additional yield on top — by supplying mSOL as collateral, LP'ing into mSOL/SOL pairs, or borrowing against it for delta-neutral plays.",
      "Stacking yield on mSOL stacks risk: smart-contract risk on Marinade plus the venue you compose into. dreyv surfaces both layers before you sign.",
    ],
    yieldShape: [
      "Base validator yield (auto-compounded into redemption ratio)",
      "Lending APY when supplied as collateral",
      "LP fees + emissions on mSOL/SOL pools",
    ],
    venues: [
      { name: "Kamino mSOL lending", kind: "lending", href: "https://app.kamino.finance/", notes: "Supply mSOL, earn lending APY on top of base yield." },
      { name: "Orca mSOL/SOL pool", kind: "lp", href: "https://www.orca.so/", notes: "Concentrated liquidity on a near-pegged pair." },
      { name: "Marinade Native", kind: "lst", href: "https://marinade.finance/app/staking", notes: "Direct stake without the LST layer if composability isn't needed." },
    ],
    treasuryFit: {
      good: [
        "Treasuries that already hold mSOL and want to compose without unstaking",
        "Long-duration positions that can absorb LST/SOL ratio drift",
      ],
      bad: [
        "Short-horizon SOL exposure — instant unstake fees during stress are real",
      ],
    },
    riskNotes: [
      "Smart contract risk on Marinade + every venue you compose into",
      "Instant unstake fees can spike during stress conditions",
      "LST/SOL ratio fluctuation under market stress",
    ],
    dreyvWorkflows: [
      { label: "Supply mSOL", href: "/app", description: "Route mSOL into Kamino with simulated impact preview." },
      { label: "LP mSOL/SOL", href: "/app", description: "Concentrated-liquidity entry with range and fee projections." },
    ],
  },
  {
    slug: "jitosol",
    symbol: "JitoSOL",
    name: "Jito Staked SOL",
    tagline:
      "JitoSOL yield strategies — MEV-enhanced staking yield plus Solana DeFi composability for treasuries that want productive SOL.",
    overview: [
      "JitoSOL captures both base staking yield and MEV tips redistributed by Jito's validator client. For treasuries optimizing for raw yield on SOL exposure, JitoSOL has historically led the LST pack by 1–2%.",
      "Like mSOL, JitoSOL is composable across the Solana DeFi stack — supply on Kamino, LP into JitoSOL/SOL, or use as collateral for stablecoin borrowing.",
    ],
    yieldShape: [
      "Base validator yield (compounds into redemption ratio)",
      "MEV tip redistribution from Jito-Solana validator client",
      "Optional lending and LP yield when composed",
    ],
    venues: [
      { name: "Kamino JitoSOL lending", kind: "lending", href: "https://app.kamino.finance/", notes: "Supply JitoSOL, stack lending APY." },
      { name: "Drift JitoSOL collateral", kind: "lending", href: "https://app.drift.trade/", notes: "Use JitoSOL as cross-margin collateral." },
      { name: "Jito staking", kind: "lst", href: "https://www.jito.network/staking/", notes: "Direct mint of JitoSOL." },
    ],
    treasuryFit: {
      good: [
        "Treasuries optimizing yield-per-SOL within liquid-staking risk budget",
        "Positions used as collateral elsewhere in the stack",
      ],
      bad: [
        "Treasuries that need same-block SOL liquidity for operations",
      ],
    },
    riskNotes: [
      "Smart contract risk on Jito Stake Pool",
      "MEV yield is variable — historical above-baseline returns are not guaranteed",
      "LST/SOL ratio drift under stress",
    ],
    dreyvWorkflows: [
      { label: "Stake into JitoSOL", href: "/app", description: "Compare against mSOL and native with full fee surface." },
      { label: "Use as collateral", href: "/app", description: "Supply JitoSOL on Kamino or Drift with simulated impact." },
    ],
  },
  {
    slug: "jlp",
    symbol: "JLP",
    name: "Jupiter Perps LP",
    tagline:
      "JLP is Jupiter's perps liquidity pool — counterparty to leveraged traders, paying treasury LPs in fees with directional exposure to the underlying basket.",
    overview: [
      "JLP is a pool token representing a basket (SOL, ETH, BTC, USDC, USDT) that acts as the counterparty to traders on Jupiter Perps. LPs earn 70% of trading and borrowing fees, in exchange for taking the other side of the trade.",
      "JLP is not a stablecoin yield — its price moves with the basket. Treasuries treat JLP as a hybrid position: yield-bearing exposure to a SOL/ETH/BTC index with a stablecoin tail.",
      "The decision to hold JLP is the decision to hold the basket. dreyv surfaces basket composition, current weights, and historical drawdowns alongside the headline APY.",
    ],
    yieldShape: [
      "70% of perps trading + borrowing fees, distributed pro-rata",
      "Underlying basket appreciation/depreciation (this is the dominant variable)",
    ],
    venues: [
      { name: "Jupiter Perps", kind: "perps-lp", href: "https://jup.ag/perps-earn", notes: "Mint and redeem JLP at NAV (with fees and cooldowns)." },
    ],
    treasuryFit: {
      good: [
        "Treasuries that want indexed SOL/ETH/BTC exposure with yield on top",
        "Positions sized to the directional risk of the underlying basket",
      ],
      bad: [
        "Treasuries treating JLP as a stablecoin substitute — it isn't",
        "Short-horizon positions where basket drawdown would force a sale",
      ],
    },
    riskNotes: [
      "Directional exposure to SOL, ETH, BTC — not a stable yield",
      "Smart contract risk on Jupiter Perps program",
      "Cooldown and redemption fees on exit",
      "Counterparty exposure: profitable traders are LPs' losses",
    ],
    dreyvWorkflows: [
      { label: "Mint JLP", href: "/app", description: "Route into JLP with basket weights and fee schedule shown pre-trade." },
      { label: "Project JLP", href: "/atlas/strategy-lab", description: "Forecast yield + basket scenarios side-by-side." },
    ],
  },
];

export function getYieldAsset(slug: string): AtlasYieldAsset | undefined {
  const lower = slug.toLowerCase();
  return ATLAS_YIELD_ASSETS.find((a) => a.slug === lower);
}

export function getAllYieldSlugs(): string[] {
  return ATLAS_YIELD_ASSETS.map((a) => a.slug);
}
