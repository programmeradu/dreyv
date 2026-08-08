/**
 * GET /api/solana/network-health
 *
 * Returns Solana network vitals for the Atlas header chip:
 * { tps: number, slot: number, samples: number, status: 'healthy' | 'degraded' | 'congested' }
 *
 * Uses Helius RPC if HELIUS_API_KEY is set, falls back to public mainnet.
 * Cached for 10s at the edge.
 */

import { NextResponse } from "next/server";

export const revalidate = 0;

let cache: { ts: number; payload: any } | null = null;
const TTL_MS = 10_000;

function classify(tps: number): "healthy" | "degraded" | "congested" {
  if (tps >= 2500) return "healthy";
  if (tps >= 1200) return "degraded";
  return "congested";
}

async function rpc<T = any>(endpoint: string, method: string, params: any[] = []): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method} error: ${json.error.message}`);
  return json.result as T;
}

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return NextResponse.json(cache.payload, {
      headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" },
    });
  }

  const heliusKey = process.env.HELIUS_API_KEY;
  const endpoint = heliusKey
    ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
    : "https://api.mainnet-beta.solana.com";

  try {
    const [samples, slot] = await Promise.all([
      rpc<Array<{ numTransactions: number; samplePeriodSecs: number; slot: number }>>(
        endpoint,
        "getRecentPerformanceSamples",
        [3]
      ),
      rpc<number>(endpoint, "getSlot", []),
    ]);

    const valid = (samples || []).filter((s) => s.samplePeriodSecs > 0);
    const tps =
      valid.length > 0
        ? Math.round(
            valid.reduce((acc, s) => acc + s.numTransactions / s.samplePeriodSecs, 0) / valid.length
          )
        : 0;

    const payload = {
      tps,
      slot,
      samples: valid.length,
      status: classify(tps),
      ts: Date.now(),
    };
    cache = { ts: Date.now(), payload };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { tps: 0, slot: 0, samples: 0, status: "congested", error: err.message },
      { status: 200 }
    );
  }
}
