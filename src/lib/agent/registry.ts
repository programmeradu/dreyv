/**
 * Single capability registry — the source of truth for both:
 *   • MCP tool registration (`/api/mcp`)
 *   • x402 resource enumeration (`/.well-known/x402`)
 *   • agent-skills index
 *
 * Add new tools here; everything downstream reads from this list.
 */

import type { ApiScope } from "@/lib/api-keys/public-keys";

export type PricingMode = "free" | "metered";

export interface AgentCapability {
  /** Stable MCP tool id, e.g. "atlas.search" */
  id: string;
  /** Public path the capability is exposed at (REST) */
  resource: string;
  /** One-line agent-facing description */
  description: string;
  /** Required scopes (any one is sufficient unless `allRequired: true`) */
  requiredScopes: ApiScope[];
  allRequired?: boolean;
  /** Pricing */
  pricing: PricingMode;
  /** USDC base-units (1e6 = 1 USDC) — only meaningful when pricing === "metered" */
  priceAtomic?: string;
  /** Brief input shape, for tools/list discovery */
  inputHint?: Record<string, string>;
}

export const AGENT_CAPABILITIES: AgentCapability[] = [
  {
    id: "atlas.search",
    resource: "/api/v1/atlas/search",
    description: "Search Solana protocols, tokens, pools, vaults by natural language.",
    requiredScopes: ["read:market", "read:search"],
    pricing: "free",
    inputHint: { q: "string" },
  },
  {
    id: "atlas.protocol",
    resource: "/api/v1/atlas/protocol",
    description: "Get protocol risk, TVL, and integration depth for a Solana protocol.",
    requiredScopes: ["read:market"],
    pricing: "free",
    inputHint: { slug: "string" },
  },
  {
    id: "foresight.simulate",
    resource: "/api/v1/foresight/simulate",
    description: "Run a treasury foresight simulation against live portfolio data.",
    requiredScopes: ["write:simulate"],
    pricing: "metered",
    priceAtomic: "5000", // $0.005 USDC
    inputHint: { horizon_days: "number", scenario: "string" },
  },
  {
    id: "vault.read",
    resource: "/api/v1/vault/read",
    description: "Read vault balances, members, and pending proposals.",
    requiredScopes: ["read:treasury"],
    pricing: "free",
    inputHint: { address: "string" },
  },
  {
    id: "vault.propose",
    resource: "/api/v1/vault/propose",
    description: "Build an unsigned Squads multisig proposal. Returns serialized tx for the user to sign.",
    requiredScopes: ["write:intent"],
    pricing: "metered",
    priceAtomic: "10000", // $0.01 USDC
    inputHint: { address: "string", instructions: "array" },
  },
  {
    id: "insights.daily",
    resource: "/api/v1/insights/daily",
    description: "Latest daily insights digest for the authorized treasury.",
    requiredScopes: ["read:insights"],
    pricing: "free",
  },
  {
    id: "insights.anomalies",
    resource: "/api/v1/insights/anomalies",
    description: "Recent anomalies and risk flags.",
    requiredScopes: ["read:insights"],
    pricing: "free",
  },
];

export function getCapability(id: string): AgentCapability | null {
  return AGENT_CAPABILITIES.find((c) => c.id === id) ?? null;
}
