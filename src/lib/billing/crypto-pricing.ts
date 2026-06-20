/**
 * Crypto subscription pricing — 10% discount vs USD card price.
 * Stables settle 1:1; SOL is live-priced via Jupiter.
 */
import { tokenFor, type CryptoAsset, type CryptoChain } from "./crypto-config";

export type CryptoTier = "mini" | "max";

const USD_BY_TIER: Record<CryptoTier, number> = { mini: 49, max: 199 };
const CRYPTO_DISCOUNT = 0.10;

export function usdPriceFor(tier: CryptoTier): number {
    const base = USD_BY_TIER[tier];
    return Math.round(base * (1 - CRYPTO_DISCOUNT) * 100) / 100; // 44.10 / 179.10
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

async function fetchSolUsd(): Promise<number> {
    const res = await fetch(`https://price.jup.ag/v6/price?ids=${SOL_MINT}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`Jupiter price fetch failed: ${res.status}`);
    const json = await res.json() as { data?: Record<string, { price?: number }> };
    const price = json?.data?.[SOL_MINT]?.price;
    if (!price || price <= 0) throw new Error("Jupiter returned no SOL price");
    return price;
}

/**
 * Compute the on-chain amount in the asset's smallest unit (decimals-aware).
 * Returns bigint for safe encoding even on BNB USDT (18 decimals).
 */
export async function computeAmountMinor(
    tier: CryptoTier,
    chain: CryptoChain,
    asset: CryptoAsset,
    amountUsdOverride?: number,
): Promise<{ amountMinor: bigint; amountDisplay: string; amountUsd: number; decimals: number }> {
    const token = tokenFor(chain, asset);
    if (!token) throw new Error(`Unsupported asset ${asset} on ${chain}`);
    const usd = amountUsdOverride != null ? amountUsdOverride : usdPriceFor(tier);

    let amountFloat: number;
    if (token.stable) {
        amountFloat = usd;
    } else {
        const solUsd = await fetchSolUsd();
        amountFloat = usd / solUsd;
    }

    // Convert to smallest unit using string math to avoid float drift on 18-dec assets.
    const [whole, fracRaw = ""] = amountFloat.toFixed(token.decimals).split(".");
    const frac = (fracRaw + "0".repeat(token.decimals)).slice(0, token.decimals);
    const amountMinor = BigInt(whole + frac);

    // Stables show up to 6 decimal places (drop trailing zeros) so micro-payments
    // like $0.10 don't get rounded to 0.10 when the SKU is actually $0.001234.
    const display = token.stable
        ? trimTrailingZeros(amountFloat.toFixed(Math.min(6, token.decimals)))
        : trimTrailingZeros(amountFloat.toFixed(Math.min(6, token.decimals)));

    return { amountMinor, amountDisplay: display, amountUsd: usd, decimals: token.decimals };
}

function trimTrailingZeros(s: string): string {
    if (!s.includes(".")) return s;
    return s.replace(/\.?0+$/, "") || "0";
}
