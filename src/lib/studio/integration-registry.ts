/**
 * Integration Registry — maps integration ids to required secrets/connectors.
 * Used by /api/studio/plan to mark each suggested integration as ready or needs-setup.
 */

export type IntegrationStatus = "ready" | "needs_setup" | "researching";

export interface IntegrationDef {
  id: string;
  name: string;
  category: "rpc" | "swap" | "staking" | "data" | "oracle" | "social" | "storage" | "ai" | "other";
  description: string;
  requiredEnv: string[]; // env var names that must be present for "ready"
  docsUrl?: string;
  knownProtocol?: string; // for matching prompts
}

export const INTEGRATION_REGISTRY: Record<string, IntegrationDef> = {
  helius: {
    id: "helius",
    name: "Helius RPC",
    category: "rpc",
    description: "High-performance Solana RPC + enhanced APIs.",
    requiredEnv: ["HELIUS_API_KEY"],
    docsUrl: "https://docs.helius.dev",
    knownProtocol: "helius",
  },
  jupiter: {
    id: "jupiter",
    name: "Jupiter Swap",
    category: "swap",
    description: "Best-route swap aggregator on Solana.",
    requiredEnv: [], // public API
    docsUrl: "https://station.jup.ag/docs/apis/swap-api",
    knownProtocol: "jupiter",
  },
  marinade: {
    id: "marinade",
    name: "Marinade Liquid Staking",
    category: "staking",
    description: "mSOL liquid staking SDK.",
    requiredEnv: [],
    docsUrl: "https://docs.marinade.finance",
    knownProtocol: "marinade",
  },
  streamflow: {
    id: "streamflow",
    name: "Streamflow",
    category: "other",
    description: "Token streaming and vesting on Solana.",
    requiredEnv: [],
    docsUrl: "https://docs.streamflow.finance",
    knownProtocol: "streamflow",
  },
  squads: {
    id: "squads",
    name: "Squads Multisig",
    category: "other",
    description: "Solana multisig program SDK.",
    requiredEnv: [],
    docsUrl: "https://docs.squads.so",
    knownProtocol: "squads",
  },
  coingecko: {
    id: "coingecko",
    name: "CoinGecko",
    category: "data",
    description: "Token prices and market data.",
    requiredEnv: [],
    docsUrl: "https://www.coingecko.com/en/api/documentation",
    knownProtocol: "coingecko",
  },
  pyth: {
    id: "pyth",
    name: "Pyth Oracles",
    category: "oracle",
    description: "Real-time on-chain price oracles.",
    requiredEnv: [],
    docsUrl: "https://docs.pyth.network",
    knownProtocol: "pyth",
  },
  dexscreener: {
    id: "dexscreener",
    name: "DexScreener",
    category: "data",
    description: "DEX pair / liquidity discovery API.",
    requiredEnv: [],
    docsUrl: "https://docs.dexscreener.com",
    knownProtocol: "dexscreener",
  },
};

/**
 * Compute current integration status from environment availability.
 */
export function getIntegrationStatus(def: IntegrationDef): IntegrationStatus {
  if (def.requiredEnv.length === 0) return "ready";
  const allPresent = def.requiredEnv.every((k) => !!process.env[k]);
  return allPresent ? "ready" : "needs_setup";
}

/**
 * Suggest integrations relevant to a free-text prompt (cold-start heuristic).
 */
export function suggestIntegrations(prompt: string): IntegrationDef[] {
  const lower = prompt.toLowerCase();
  const suggested: IntegrationDef[] = [];

  // Always suggest a price source if the prompt mentions $, USD, price, value
  if (/\b(price|usd|\$|value|portfolio|balance)/i.test(lower)) {
    suggested.push(INTEGRATION_REGISTRY.coingecko, INTEGRATION_REGISTRY.pyth);
  }
  if (/\b(swap|trade|jupiter|exchange|dex)/i.test(lower)) {
    suggested.push(INTEGRATION_REGISTRY.jupiter, INTEGRATION_REGISTRY.dexscreener);
  }
  if (/\b(stake|staking|msol|marinade|validator|yield)/i.test(lower)) {
    suggested.push(INTEGRATION_REGISTRY.marinade);
  }
  if (/\b(stream|vest|payroll|recurring|streamflow)/i.test(lower)) {
    suggested.push(INTEGRATION_REGISTRY.streamflow);
  }
  if (/\b(multisig|squad|treasury|dao governance)/i.test(lower)) {
    suggested.push(INTEGRATION_REGISTRY.squads);
  }

  // Default RPC if Solana-flavored
  if (/\b(solana|spl|token|wallet|on-?chain)/i.test(lower) && !suggested.includes(INTEGRATION_REGISTRY.helius)) {
    suggested.push(INTEGRATION_REGISTRY.helius);
  }

  // De-dupe
  return Array.from(new Set(suggested));
}

/**
 * Detect protocol-like words the registry doesn't know about.
 * These trigger Firecrawl/Perplexity research.
 */
export function detectUnknownProtocols(prompt: string): string[] {
  const known = new Set(
    Object.values(INTEGRATION_REGISTRY)
      .map((d) => d.knownProtocol)
      .filter(Boolean) as string[]
  );
  // Common Solana/DeFi protocol-name shape: capitalized words or .fi / .so domains
  const matches = prompt.match(/\b([A-Z][a-zA-Z0-9]{3,})\b|\b([a-z0-9-]+\.(?:fi|so|xyz|finance))\b/g) || [];
  const blacklist = new Set([
    "Solana", "App", "Build", "Create", "Make", "USD", "USDC", "SOL", "DAO", "NFT",
    "DeFi", "DEX", "API", "SDK", "JSON", "TypeScript", "React", "UI", "DCA",
  ]);
  const found = new Set<string>();
  for (const m of matches) {
    const cleaned = m.toLowerCase().replace(/\.(fi|so|xyz|finance)$/, "");
    if (!known.has(cleaned) && !blacklist.has(m) && cleaned.length >= 4) {
      found.add(m);
    }
  }
  return Array.from(found).slice(0, 3); // cap to prevent runaway research
}
