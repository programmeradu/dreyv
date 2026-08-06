/**
 * GET /api/evm/holdings?address=0x…&chain=ethereum|base|arbitrum|polygon|bsc
 *
 * Read-only EVM holdings, mirroring the contract of
 * /api/helius/das/wallet-holdings (returns `{ holdings, total }` with the same
 * per-row shape: { mint, symbol, name, address, balance, amount, decimals, logo, price?, value? }).
 *
 * Provider: Alchemy `alchemy_getTokenBalances` + `alchemy_getTokenMetadata`.
 * Pricing: Alchemy Prices API (best-effort) — returns 0 when unavailable.
 */

import { NextRequest, NextResponse } from "next/server";
import { EVM_ENABLED } from "@/lib/feature-flags";
export const runtime = "edge";

export const dynamic = "force-dynamic";

type Chain = "ethereum" | "base" | "arbitrum" | "polygon" | "bsc";

const ALCHEMY_HOST: Record<Chain, string | null> = {
    ethereum: "eth-mainnet.g.alchemy.com",
    base: "base-mainnet.g.alchemy.com",
    arbitrum: "arb-mainnet.g.alchemy.com",
    polygon: "polygon-mainnet.g.alchemy.com",
    bsc: "bnb-mainnet.g.alchemy.com",
};

const NATIVE: Record<Chain, { symbol: string; name: string; decimals: number; coingeckoId: string }> = {
    ethereum: { symbol: "ETH", name: "Ether", decimals: 18, coingeckoId: "ethereum" },
    base: { symbol: "ETH", name: "Ether (Base)", decimals: 18, coingeckoId: "ethereum" },
    arbitrum: { symbol: "ETH", name: "Ether (Arbitrum)", decimals: 18, coingeckoId: "ethereum" },
    polygon: { symbol: "MATIC", name: "Polygon", decimals: 18, coingeckoId: "matic-network" },
    bsc: { symbol: "BNB", name: "BNB", decimals: 18, coingeckoId: "binancecoin" },
};

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function isValidEvmAddress(addr: string | null): addr is string {
    if (!addr) return false;
    return HEX_ADDRESS.test(addr);
}

function toChain(input: string | null): Chain {
    const v = (input ?? "ethereum").toLowerCase();
    if (v === "ethereum" || v === "base" || v === "arbitrum" || v === "polygon" || v === "bsc") return v;
    return "ethereum";
}

function hexToBigInt(hex: string | null | undefined): bigint {
    if (!hex || typeof hex !== "string") return BigInt(0);
    try {
        return BigInt(hex);
    } catch {
        return BigInt(0);
    }
}

async function alchemyJsonRpc<T = unknown>(
    host: string,
    apiKey: string,
    method: string,
    params: unknown[],
): Promise<T | null> {
    try {
        const res = await fetch(`https://${host}/v2/${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            cache: "no-store",
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        if (!data) return null;
        if (data.error) return null;
        return data.result as T;
    } catch {
        return null;
    }
}

async function fetchNativePrice(coingeckoId: string): Promise<number> {
    try {
        const res = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
            { next: { revalidate: 60 } as any },
        );
        if (!res.ok) return 0;
        const data = (await res.json()) as Record<string, { usd?: number }>;
        return Number(data?.[coingeckoId]?.usd ?? 0) || 0;
    } catch {
        return 0;
    }
}

interface AlchemyTokenBalance {
    contractAddress: string;
    tokenBalance: string | null;
    error?: string | null;
}

interface AlchemyTokenMetadata {
    decimals?: number | null;
    logo?: string | null;
    name?: string | null;
    symbol?: string | null;
}

export async function GET(req: NextRequest) {
    if (!EVM_ENABLED) {
        return NextResponse.json({ holdings: [], total: 0, paused: true }, { status: 200 });
    }
    const { searchParams } = new URL(req.url);
    const addressRaw = searchParams.get("address");
    const chain = toChain(searchParams.get("chain"));
    const address = addressRaw?.toLowerCase() ?? null;

    if (!isValidEvmAddress(address)) {
        return new Response(JSON.stringify({ error: "address must be 0x-prefixed 20-byte hex" }), { status: 400 });
    }

    const apiKey = process.env.ALCHEMY_API_KEY;
    const host = ALCHEMY_HOST[chain];
    if (!apiKey || !host) {
        return new Response(
            JSON.stringify({ error: "Missing ALCHEMY_API_KEY or unsupported chain" }),
            { status: 500 },
        );
    }

    try {
        const [nativeBalanceHex, balancesResult] = await Promise.all([
            alchemyJsonRpc<string>(host, apiKey, "eth_getBalance", [address, "latest"]),
            alchemyJsonRpc<{ address: string; tokenBalances: AlchemyTokenBalance[] }>(host, apiKey, "alchemy_getTokenBalances", [address]),
        ]);

        const tokenBalances = balancesResult?.tokenBalances ?? [];
        const nonZero = tokenBalances.filter((t) => {
            const v = hexToBigInt(t.tokenBalance);
            return v > BigInt(0);
        });

        // Cap metadata fetches at 25 to keep latency bounded.
        const top = nonZero.slice(0, 25);
        const metadata = await Promise.all(
            top.map((t) =>
                alchemyJsonRpc<AlchemyTokenMetadata>(host, apiKey, "alchemy_getTokenMetadata", [
                    t.contractAddress,
                ]),
            ),
        );

        const native = NATIVE[chain];
        const nativeBalance = hexToBigInt(nativeBalanceHex);
        const nativeAmountStr = nativeBalance.toString();
        const nativePrice = await fetchNativePrice(native.coingeckoId);
        const nativeAmountFloat = Number(nativeAmountStr) / 10 ** native.decimals;

        const holdings = top.map((t, i) => {
            const meta = metadata[i] ?? {};
            const decimals = typeof meta.decimals === "number" ? meta.decimals : 18;
            const balance = hexToBigInt(t.tokenBalance).toString();
            const amount = balance;
            return {
                mint: t.contractAddress,
                address: t.contractAddress,
                symbol: meta.symbol || "TOKEN",
                name: meta.name || meta.symbol || "Unknown Token",
                balance,
                amount,
                decimals,
                logo: meta.logo ?? undefined,
                price: 0,
                value: 0,
            };
        });

        const nativeRow = {
            mint: "0x0000000000000000000000000000000000000000",
            address: "0x0000000000000000000000000000000000000000",
            symbol: native.symbol,
            name: native.name,
            balance: nativeAmountStr,
            amount: nativeAmountStr,
            decimals: native.decimals,
            logo: undefined,
            price: nativePrice,
            value: nativeAmountFloat * nativePrice,
            isNative: true as const,
        };

        const allHoldings = [nativeRow, ...holdings];

        return new Response(
            JSON.stringify({
                holdings: allHoldings,
                total: allHoldings.length,
                chain,
                address,
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "private, max-age=30",
                },
            },
        );
    } catch (e: any) {
        console.error("[evm/holdings] error:", e);
        return new Response(JSON.stringify({ error: "Failed to fetch EVM holdings" }), { status: 500 });
    }
}
