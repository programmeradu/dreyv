/**
 * Curated list of Solana tokens with editorial copy for programmatic SEO.
 * Each entry produces a unique, indexable page at /atlas/tokens/[symbol].
 *
 * Keep entries factual and evergreen. Avoid price claims (they go stale and
 * trigger soft-404 / "thin content" demotion). Focus on what the token does,
 * how treasuries use it, and the dreyv workflows that touch it.
 */

export type AtlasToken = {
  symbol: string;
  name: string;
  category: "native" | "lst" | "stablecoin" | "defi" | "memecoin" | "infra";
  mint?: string;
  /** One-line meta description (<160 chars). */
  tagline: string;
  /** 2-3 paragraph overview rendered into the page body. */
  overview: string[];
  /** Treasury-specific use cases (bullet list). */
  treasuryUseCases: string[];
  /** Concrete dreyv workflows that touch this asset. */
  dreyvWorkflows: { label: string; href: string; description: string }[];
  /** Authoritative external links (used for outbound trust signal). */
  references: { label: string; href: string }[];
  /** Risk notes — short, honest. */
  riskNotes: string[];
};

export const ATLAS_TOKENS: AtlasToken[] = [
  {
    symbol: "SOL",
    name: "Solana",
    category: "native",
    tagline:
      "SOL is the native asset of the Solana network — used for transaction fees, staking, and as the base reserve for most Solana treasuries.",
    overview: [
      "SOL is the gas, staking, and reserve asset of the Solana blockchain. Every transaction on Solana — whether a Jupiter swap, a Squads multisig approval, or a Marinade stake — settles fees in SOL, which makes it the operational floor of any Solana-native treasury.",
      "For DAOs and protocol teams, SOL holdings typically split across three buckets: liquid runway (held in a multisig vault), staked yield (delegated to validators or liquid staking), and operating float (rotated to stablecoins for predictable spend).",
      "dreyv treats SOL as the canonical unit for projections — when you ask `what if SOL hits $400`, the projection engine pulls live balance context (or a number you supply) and forks current market state for the simulation.",
    ],
    treasuryUseCases: [
      "Network fee reserve for all on-chain operations",
      "Native staking yield (5-7% APY via direct delegation or LSTs)",
      "Collateral for Solana-native lending markets",
      "Base pair for swaps and DCA programs against stablecoins",
    ],
    dreyvWorkflows: [
      {
        label: "Stake SOL",
        href: "/app",
        description: "Route to Marinade, Jito, or direct delegation with simulation.",
      },
      {
        label: "DCA into SOL",
        href: "/app",
        description: "Set recurring USDC → SOL buys with vault-aware execution.",
      },
      {
        label: "Project SOL upside",
        href: "/atlas/strategy-lab",
        description: "Run live what-if scenarios with current market state.",
      },
    ],
    references: [
      { label: "Solana docs", href: "https://docs.solana.com/" },
      { label: "Solana Foundation", href: "https://solana.org/" },
    ],
    riskNotes: [
      "Validator concentration and slashing risk for direct stakes",
      "Smart contract risk on liquid staking derivatives",
      "Network outage history — keep operational float liquid",
    ],
  },
  {
    symbol: "USDC",
    name: "USD Coin (Solana)",
    category: "stablecoin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tagline:
      "USDC on Solana is the dominant fiat-pegged stablecoin used by DAOs and protocols for payroll, vendor payments, and operating runway.",
    overview: [
      "USDC is a fully-reserved US dollar stablecoin issued by Circle and natively supported on Solana. For Solana treasuries, USDC is the working-capital asset: predictable, redeemable 1:1 for fiat through Circle, and accepted by every major on-chain venue.",
      "Treasuries typically hold a 3-12 month runway in USDC, segmented across a hot operating wallet, a multisig signing vault, and (optionally) a yield position in a vetted lending market like Kamino or MarginFi.",
      "Within dreyv, USDC is the default settlement token for payroll runs, vendor disbursements, and rebalancing back-stops when you reduce SOL exposure.",
    ],
    treasuryUseCases: [
      "Operating runway and payroll funding",
      "Stable leg of DCA programs",
      "Yield via lending markets (Kamino, MarginFi, Drift)",
      "Settlement currency for marketplace and contributor payments",
    ],
    dreyvWorkflows: [
      {
        label: "Run payroll in USDC",
        href: "/app",
        description: "Multi-recipient batch with simulation and Squads approval.",
      },
      {
        label: "Park idle USDC",
        href: "/app",
        description: "Suggest vetted lending venues based on amount and risk profile.",
      },
      {
        label: "Rebalance to USDC",
        href: "/app",
        description: "Reduce volatile exposure with simulated impact preview.",
      },
    ],
    references: [
      { label: "Circle USDC", href: "https://www.circle.com/usdc" },
      { label: "Solana token list", href: "https://github.com/solana-labs/token-list" },
    ],
    riskNotes: [
      "Issuer (Circle) and US banking system dependency",
      "Bridge risk if moved to/from other chains",
      "Smart contract risk on any yield venue",
    ],
  },
  {
    symbol: "USDT",
    name: "Tether (Solana)",
    category: "stablecoin",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    tagline:
      "USDT on Solana provides deep liquidity for stablecoin pairs, often used alongside USDC for diversification and cross-venue settlement.",
    overview: [
      "USDT (Tether) is the largest stablecoin by market cap and has native Solana issuance with deep DEX and CEX liquidity. Treasuries hold USDT primarily as a diversification leg against single-issuer risk on USDC, or to settle with counterparties that prefer Tether.",
      "On Solana, USDT/USDC pairs are some of the deepest liquidity pools, making USDT useful for large rebalancing flows where slippage matters more than issuer preference.",
      "dreyv supports USDT as a swap target, payroll token, and rebalancing destination — with the same simulation guarantees as USDC.",
    ],
    treasuryUseCases: [
      "Issuer diversification away from a single stablecoin",
      "Counterparty settlement when USDT is preferred",
      "Deep-liquidity rebalancing without slippage",
      "Bridge endpoint for cross-chain treasury moves",
    ],
    dreyvWorkflows: [
      {
        label: "Swap to USDT",
        href: "/app",
        description: "Routed via Jupiter with pre-trade impact preview.",
      },
      {
        label: "Audit USDT exposure",
        href: "/app",
        description: "Inspect mint authority, freeze authority, and pool depth.",
      },
    ],
    references: [
      { label: "Tether transparency", href: "https://tether.to/en/transparency/" },
    ],
    riskNotes: [
      "Issuer transparency historically less detailed than Circle",
      "Regulatory exposure varies by jurisdiction",
    ],
  },
  {
    symbol: "JITOSOL",
    name: "Jito Staked SOL",
    category: "lst",
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    tagline:
      "JitoSOL is a liquid staking token that captures both base staking yield and MEV rewards distributed by the Jito network.",
    overview: [
      "JitoSOL is the liquid staking derivative issued by the Jito protocol. Each JitoSOL represents a claim on a pool of staked SOL plus accrued MEV (maximal extractable value) tips that Jito's validator client captures and redistributes to stakers.",
      "Treasuries use JitoSOL to keep SOL exposure productive without locking it: balances stay liquid, can be used as collateral on Solana lending markets, and accrue yield that historically beats vanilla staking by 1-2%.",
      "dreyv routes 'stake SOL' intents to Jito when MEV-aware yield is the priority, with side-by-side comparison against Marinade and direct delegation in the planning step.",
    ],
    treasuryUseCases: [
      "Liquid SOL exposure with MEV-enhanced yield",
      "Collateral on Kamino, MarginFi, and Drift",
      "LP base for JitoSOL/SOL pools",
    ],
    dreyvWorkflows: [
      {
        label: "Stake into JitoSOL",
        href: "/app",
        description: "Compare Jito vs Marinade vs native before signing.",
      },
      {
        label: "Project staking yield",
        href: "/atlas/strategy-lab",
        description: "Forecast yield + MEV at variable SOL price.",
      },
    ],
    references: [
      { label: "Jito docs", href: "https://docs.jito.network/" },
    ],
    riskNotes: [
      "Smart contract risk on the staking pool",
      "Validator set centralization risk",
      "De-peg risk in stress conditions (LST/SOL ratio)",
    ],
  },
  {
    symbol: "MSOL",
    name: "Marinade Staked SOL",
    category: "lst",
    mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    tagline:
      "mSOL is Marinade Finance's liquid staking token, distributing stake across hundreds of validators for decentralization-first yield.",
    overview: [
      "mSOL is issued by Marinade, the longest-running liquid staking protocol on Solana. mSOL holders earn standard staking yield while Marinade auto-delegates the underlying SOL across a wide validator set selected for performance and decentralization.",
      "Treasuries that prioritize validator decentralization over MEV-enhanced yield typically choose mSOL. It also has deep DEX integration and is widely accepted as collateral.",
      "dreyv presents mSOL as a default option in the staking planner, with transparent comparisons to Jito and direct delegation.",
    ],
    treasuryUseCases: [
      "Decentralization-aligned liquid staking",
      "Collateral across Solana lending markets",
      "LP base for mSOL/SOL pools",
    ],
    dreyvWorkflows: [
      {
        label: "Stake into mSOL",
        href: "/app",
        description: "One-click route with Squads multisig approval.",
      },
      {
        label: "Unstake mSOL",
        href: "/app",
        description: "Choose instant (with fee) or epoch-delayed redemption.",
      },
    ],
    references: [
      { label: "Marinade docs", href: "https://docs.marinade.finance/" },
    ],
    riskNotes: [
      "Smart contract risk",
      "Instant unstake fees during stress",
      "LST/SOL ratio fluctuation",
    ],
  },
  {
    symbol: "JUP",
    name: "Jupiter",
    category: "defi",
    tagline:
      "JUP is the governance token of Jupiter, the dominant DEX aggregator on Solana that routes nearly all major swap flow.",
    overview: [
      "Jupiter is the leading liquidity aggregator on Solana, routing trades across every major DEX and AMM to deliver best execution. JUP is its governance token, used for protocol decisions, staking, and access to launchpad allocations.",
      "Treasuries hold JUP either as a strategic position in Solana DeFi infrastructure or as a yield asset (via JUP staking and votes-for-rewards programs).",
      "dreyv uses Jupiter under the hood for every swap and DCA route — when you ask 'swap 100 SOL to USDC', the planner shows the Jupiter route, expected slippage, and price impact before you sign.",
    ],
    treasuryUseCases: [
      "Strategic exposure to Solana DEX infrastructure",
      "Governance participation",
      "Staking for vote rewards and launchpad access",
    ],
    dreyvWorkflows: [
      {
        label: "Audit JUP",
        href: "/app",
        description: "Inspect mint, distribution, and governance state.",
      },
      {
        label: "Swap to JUP",
        href: "/app",
        description: "Aggregated route with simulated impact.",
      },
    ],
    references: [
      { label: "Jupiter docs", href: "https://docs.jup.ag/" },
    ],
    riskNotes: [
      "Token unlock schedule and emission pressure",
      "Concentration of DEX flow on a single aggregator",
    ],
  },
  {
    symbol: "BONK",
    name: "Bonk",
    category: "memecoin",
    tagline:
      "BONK is the largest community-distributed memecoin on Solana, often held as ecosystem exposure or speculative position.",
    overview: [
      "BONK launched as a community airdrop and grew into one of the most liquid memecoins on Solana. While not a treasury staple, some teams hold a small BONK position as cultural ecosystem exposure or as a speculative bucket within a clearly-bounded risk budget.",
      "Audit-first thinking matters more here than for established assets: dreyv's audit tool surfaces mint authority, freeze authority, top-holder concentration, and liquidity depth before you take any meaningful position.",
    ],
    treasuryUseCases: [
      "Bounded speculative bucket within a risk-managed treasury",
      "Ecosystem-alignment exposure",
    ],
    dreyvWorkflows: [
      {
        label: "Audit BONK",
        href: "/app",
        description: "Mint authority, holder distribution, liquidity depth.",
      },
    ],
    references: [
      { label: "Bonk site", href: "https://www.bonkcoin.com/" },
    ],
    riskNotes: [
      "High volatility — size positions accordingly",
      "Memecoin sentiment risk",
      "Always re-audit before adding",
    ],
  },
  {
    symbol: "WIF",
    name: "dogwifhat",
    category: "memecoin",
    tagline:
      "WIF is a Solana memecoin with substantial market presence — treat as bounded speculative exposure, never as treasury reserve.",
    overview: [
      "WIF (dogwifhat) reached top-tier memecoin status on Solana with deep DEX liquidity and CEX listings. As with any memecoin, position sizing and risk bounds matter more than entry price.",
      "If a treasury holds WIF at all, it should sit in an explicitly-labeled speculative bucket with a hard cap, separate from operating runway and yield reserves.",
    ],
    treasuryUseCases: [
      "Strict speculative bucket only",
    ],
    dreyvWorkflows: [
      {
        label: "Audit WIF",
        href: "/app",
        description: "Surface mint state and concentration before sizing.",
      },
    ],
    references: [
      { label: "Birdeye WIF", href: "https://birdeye.so/" },
    ],
    riskNotes: [
      "Extreme volatility",
      "Sentiment-driven liquidity",
    ],
  },
];

export function getAtlasToken(symbol: string): AtlasToken | undefined {
  const upper = symbol.toUpperCase();
  return ATLAS_TOKENS.find((t) => t.symbol === upper);
}

export function getAllTokenSymbols(): string[] {
  return ATLAS_TOKENS.map((t) => t.symbol.toLowerCase());
}
