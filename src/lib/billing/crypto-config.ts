/**
 * Crypto subscription config — receiving wallets + token registry.
 *
 * Phase 1 ships Solana (USDC, USDT, SOL). EVM stables across
 * Base / Arbitrum / Polygon / BNB are wired here for Phase 2-3 but the
 * checkout route currently only allows `solana`.
 */

export type CryptoChain = "solana" | "base" | "arbitrum" | "polygon" | "bsc";
export type CryptoAsset = "usdc" | "usdt" | "sol";

/** User-provided receiving wallets. Same EVM address is reused across all EVM chains. */
export const RECEIVING_WALLETS: Record<"solana" | "evm", string> = {
    solana: "GoyXcFZPCKFvDN1o4taJPNcPNANZBQ69XMZaBaTHFrsg",
    evm: "0x16107A52ad675C1557d18954252355292BC95386",
};

export function receivingAddressFor(chain: CryptoChain): string {
    return chain === "solana" ? RECEIVING_WALLETS.solana : RECEIVING_WALLETS.evm;
}

export interface TokenInfo {
    chain: CryptoChain;
    asset: CryptoAsset;
    /** SPL mint or ERC20 contract; null for native SOL. */
    contract: string | null;
    decimals: number;
    /** True if the asset is a USD stable (1:1 against USD). */
    stable: boolean;
}

export const TOKEN_REGISTRY: TokenInfo[] = [
    // Solana
    { chain: "solana", asset: "usdc", contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, stable: true },
    { chain: "solana", asset: "usdt", contract: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, stable: true },
    { chain: "solana", asset: "sol",  contract: null,                                                decimals: 9, stable: false },
    // Base
    { chain: "base",      asset: "usdc", contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  stable: true },
    { chain: "base",      asset: "usdt", contract: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6,  stable: true },
    // Arbitrum
    { chain: "arbitrum",  asset: "usdc", contract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6,  stable: true },
    { chain: "arbitrum",  asset: "usdt", contract: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6,  stable: true },
    // Polygon
    { chain: "polygon",   asset: "usdc", contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6,  stable: true },
    { chain: "polygon",   asset: "usdt", contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6,  stable: true },
    // BNB Chain (USDT here is 18 decimals — handled per-row, never hardcoded)
    { chain: "bsc",       asset: "usdc", contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, stable: true },
    { chain: "bsc",       asset: "usdt", contract: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, stable: true },
];

export function tokenFor(chain: CryptoChain, asset: CryptoAsset): TokenInfo | null {
    return TOKEN_REGISTRY.find(t => t.chain === chain && t.asset === asset) ?? null;
}

/** Phase rollout flags — flip as we ship each phase. */
export const ENABLED_CHAINS: CryptoChain[] = ["solana"]; // Phase 1
export const ENABLED_ASSETS: Record<CryptoChain, CryptoAsset[]> = {
    solana:   ["usdc", "usdt", "sol"],
    base:     ["usdc", "usdt"],
    arbitrum: ["usdc", "usdt"],
    polygon:  ["usdc", "usdt"],
    bsc:      ["usdc", "usdt"],
};

export function isEnabled(chain: CryptoChain, asset: CryptoAsset): boolean {
    return ENABLED_CHAINS.includes(chain) && (ENABLED_ASSETS[chain] ?? []).includes(asset);
}
