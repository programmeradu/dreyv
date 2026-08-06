import { NextRequest, NextResponse } from "next/server";
import { getCurrentPricesUsd } from "@/lib/explorer/jupiter-price";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
export const runtime = "edge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!mint || mint.length < 32) return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "token-drill", max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const apiKey = process.env.HELIUS_API_KEY;
  const [px, holdersRes] = await Promise.all([
    getCurrentPricesUsd([mint]),
    apiKey
      ? fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "tla",
            method: "getTokenLargestAccounts",
            params: [mint],
          }),
          cache: "no-store",
        }).then((r) => (r.ok ? r.json() : null))
      : Promise.resolve(null),
  ]);

  const holders = (holdersRes?.result?.value ?? []).slice(0, 10).map((h: any) => ({
    address: h.address,
    uiAmount: h.uiAmount ?? Number(h.amount ?? 0),
  }));

  // Liquidity probe: ask Jupiter for quotes at $1k, $10k, $100k worth of USDC -> mint
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const liquidity: Array<{ usdIn: number; outAmount: number; priceImpactPct: number }> = [];
  for (const usd of [1000, 10000, 100000]) {
    try {
      const inAmt = usd * 1_000_000; // USDC has 6 decimals
      const r = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${USDC}&outputMint=${mint}&amount=${inAmt}&slippageBps=100`,
        { cache: "no-store" },
      );
      if (r.ok) {
        const q = await r.json();
        liquidity.push({
          usdIn: usd,
          outAmount: Number(q?.outAmount ?? 0),
          priceImpactPct: Number(q?.priceImpactPct ?? 0) * 100,
        });
      }
    } catch {
      // skip tier
    }
  }

  return NextResponse.json(
    { mint, priceUsd: px[mint] ?? null, holders, liquidity },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
