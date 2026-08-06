import { NextResponse } from "next/server";
import { YIELD_MINTS, type RiskTier } from "@/lib/yield-registry";
export const runtime = "edge";

export const dynamic = "force-dynamic";

/**
 * GET /api/yield/rates
 *
 * Returns live APY rates for all known yield-bearing tokens.
 * Fetches from multiple sources in order of reliability:
 *   1. Marinade public API (for mSOL)
 *   2. Sanctum Extra API (for all LSTs) — may be deprecated
 *   3. Conservative fallback estimates from the registry
 *
 * Response shape:
 * {
 *   rates: Record<mint, { apy, source, protocol, symbol, riskTier, aumUsd? }>,
 *   fetchedAt: string (ISO timestamp)
 * }
 */

interface RateEntry {
    apy: number;
    source: "live" | "estimated";
    protocol: string;
    symbol: string;
    riskTier: RiskTier;
    aumUsd?: number;
}

let cachedRates: Record<string, RateEntry> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
    try {
        const now = Date.now();

        // Return cached if fresh
        if (cachedRates && (now - cacheTimestamp) < CACHE_TTL_MS) {
            return NextResponse.json({
                rates: cachedRates,
                fetchedAt: new Date(cacheTimestamp).toISOString(),
                cached: true,
            });
        }

        const rates: Record<string, RateEntry> = {};
        for (const [mint, meta] of Object.entries(YIELD_MINTS)) {
            rates[mint] = {
                apy: meta.fallbackApy,
                source: "estimated",
                protocol: meta.protocol,
                symbol: meta.symbol,
                riskTier: meta.riskTier,
                aumUsd: meta.aumUsd,
            };
        }

        // ─── Source 1: Marinade public API (mSOL) ──────────────────
        const msolMint = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
        try {
            const marinadeRes = await fetch("https://api.marinade.finance/msol/apy/30d", {
                signal: AbortSignal.timeout(5000),
            });
            if (marinadeRes.ok) {
                const data = await marinadeRes.json();
                // Marinade returns { value: 0.061 } (i.e. 6.1%)
                if (typeof data?.value === "number") {
                    rates[msolMint] = {
                        ...rates[msolMint],
                        apy: parseFloat((data.value * 100).toFixed(2)),
                        source: "live",
                    };
                }
            }
        } catch {
            // Fallback is already set
        }

        // ─── Source 2: Sanctum Extra API (may be deprecated) ───────
        try {
            const sanctumMints = Object.keys(YIELD_MINTS).join(",");
            const sanctumRes = await fetch(
                `https://extra-api.sanctum.so/v1/apy/latest?lst=${sanctumMints}`,
                { signal: AbortSignal.timeout(5000) }
            );
            if (sanctumRes.ok) {
                const data = await sanctumRes.json();
                // Expected shape: { apys: { [mint]: number (as decimal, e.g. 0.064) } }
                if (data?.apys && typeof data.apys === "object") {
                    for (const [mint, apyVal] of Object.entries(data.apys)) {
                        if (mint in rates && typeof apyVal === "number") {
                            rates[mint] = {
                                ...rates[mint],
                                apy: parseFloat((apyVal * 100).toFixed(2)),
                                source: "live",
                            };
                        }
                    }
                }
            }
        } catch {
            // Sanctum API may be unavailable — fallbacks are already set
        }

        // ─── Source 3: Native Solana staking APY (Stakeview) ────────
        const nativeStakeMint = "STAKED_SOL_NATIVE";
        try {
            const stakeviewRes = await fetch("https://stakeview.app/apy/previous.json", {
                signal: AbortSignal.timeout(5000),
            });
            if (stakeviewRes.ok) {
                const data = await stakeviewRes.json();
                // Returns array of validators with APYs — compute network average
                if (Array.isArray(data) && data.length > 0) {
                    const apys = data
                        .map((v: any) => v.apy)
                        .filter((a: any) => typeof a === "number" && a > 0 && a < 1); // decimal format: 0.065 = 6.5%
                    if (apys.length > 0) {
                        const avgDecimal = apys.reduce((s: number, a: number) => s + a, 0) / apys.length;
                        const avgApy = avgDecimal * 100;
                        rates[nativeStakeMint] = {
                            ...rates[nativeStakeMint],
                            apy: parseFloat(avgApy.toFixed(2)),
                            source: "live",
                        };
                    }
                }
            }
        } catch {
            // Fallback already set from registry
        }

        // ─── Source 3.5: DefiLlama Solana yields (real opportunities) ──
        try {
            const llamaRes = await fetch("https://yields.llama.fi/pools", {
                signal: AbortSignal.timeout(7000),
                cache: "no-store",
            });
            if (llamaRes.ok) {
                const data = await llamaRes.json();
                const pools: any[] = Array.isArray(data?.data) ? data.data : [];
                const solanaPools = pools
                    .filter((p) =>
                        String(p?.chain || "").toLowerCase() === "solana" &&
                        Number(p?.tvlUsd) >= 5_000_000 &&
                        Number(p?.apy) > 0 &&
                        Number(p?.apy) < 200 // strip outliers / farm-and-dump APYs
                    )
                    .sort((a, b) => Number(b?.apy) - Number(a?.apy))
                    .slice(0, 12);

                for (const p of solanaPools) {
                    const poolId = String(p?.pool || `${p?.project}-${p?.symbol}`);
                    const project = String(p?.project || "unknown");
                    const symbol = String(p?.symbol || "?");
                    const apy = Number(p?.apy) || 0;
                    const tvl = Number(p?.tvlUsd) || 0;
                    // Risk heuristic: high TVL + low APY = low risk
                    const riskTier: RiskTier =
                        tvl >= 100_000_000 && apy < 8 ? "low"
                            : tvl >= 25_000_000 && apy < 20 ? "medium"
                                : "high";
                    rates[`llama:${poolId}`] = {
                        apy: parseFloat(apy.toFixed(2)),
                        source: "live",
                        protocol: project
                            .split("-")
                            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                            .join(" "),
                        symbol,
                        riskTier,
                        aumUsd: tvl,
                    };
                }
            }
        } catch {
            // Fallback registry already populated
        }

        // ─── Source 4: Jito staking page scrape fallback ───────────
        const jitoMint = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
        if (rates[jitoMint]?.source !== "live") {
            try {
                // Jito's public endpoint for SOL price ratio over time
                // The APY can be inferred, but for reliability we use a known public stats endpoint
                const jitoRes = await fetch("https://www.jito.network/api/staking", {
                    signal: AbortSignal.timeout(5000),
                });
                if (jitoRes.ok) {
                    const data = await jitoRes.json();
                    // Shape varies — try to extract APY if available
                    if (typeof data?.apy === "number") {
                        rates[jitoMint] = {
                            ...rates[jitoMint],
                            apy: parseFloat((data.apy * 100).toFixed(2)),
                            source: "live",
                        };
                    }
                }
            } catch {
                // Fallback is already set
            }
        }

        // Update cache
        cachedRates = rates;
        cacheTimestamp = now;

        return NextResponse.json({
            rates,
            fetchedAt: new Date(now).toISOString(),
            cached: false,
        });
    } catch (error) {
        console.error("Yield rates API error:", error);
        const fallbackRates: Record<string, RateEntry> = {};
        for (const [mint, meta] of Object.entries(YIELD_MINTS)) {
            fallbackRates[mint] = {
                apy: meta.fallbackApy,
                source: "estimated",
                protocol: meta.protocol,
                symbol: meta.symbol,
                riskTier: meta.riskTier,
                aumUsd: meta.aumUsd,
            };
        }
        return NextResponse.json({
            rates: fallbackRates,
            fetchedAt: new Date().toISOString(),
            cached: false,
            error: "Failed to fetch live rates — showing estimates",
        });
    }
}
