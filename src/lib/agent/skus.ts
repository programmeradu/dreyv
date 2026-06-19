/**
 * x402 SKU catalog. Each SKU is a single billable atomic call an autonomous
 * agent can purchase. Prices are USD; settlement is USDC on Solana (1:1).
 *
 * Keep this small and curated — every SKU is a public API contract.
 */

export interface AgentSku {
    id: string;
    name: string;
    description: string;
    priceUsd: number;
    /** What the receipt token unlocks. Pure docs for now. */
    fulfilmentHint: string;
}

export const AGENT_SKUS: Record<string, AgentSku> = {
    "dreyv.treasury.snapshot": {
        id: "dreyv.treasury.snapshot",
        name: "Treasury Snapshot",
        description: "Current portfolio value, holdings, and 24h delta for a Solana wallet.",
        priceUsd: 0.10,
        fulfilmentHint: "GET /api/x402/fulfil/treasury-snapshot?wallet=<addr> with the receipt token.",
    },
    "dreyv.treasury.report": {
        id: "dreyv.treasury.report",
        name: "Treasury AI Report",
        description: "Full AI-written treasury report: composition, concentration, runway, risk, suggestions.",
        priceUsd: 1.00,
        fulfilmentHint: "GET /api/x402/fulfil/treasury-report?wallet=<addr> with the receipt token.",
    },
    "dreyv.tier.mini.month": {
        id: "dreyv.tier.mini.month",
        name: "Mini Plan — 1 Month",
        description: "One month of the Mini plan, applied to the API key owner.",
        priceUsd: 49.00,
        fulfilmentHint: "Upgrades the API key owner to tier=mini for 30 days.",
    },
    "dreyv.tier.max.month": {
        id: "dreyv.tier.max.month",
        name: "Max Plan — 1 Month",
        description: "One month of the Max plan, applied to the API key owner.",
        priceUsd: 199.00,
        fulfilmentHint: "Upgrades the API key owner to tier=max for 30 days.",
    },
};

export function getSku(id: string): AgentSku | null {
    return AGENT_SKUS[id] ?? null;
}

export function listSkus(): AgentSku[] {
    return Object.values(AGENT_SKUS);
}
