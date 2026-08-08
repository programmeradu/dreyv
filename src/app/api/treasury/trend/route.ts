/**
 * GET /api/treasury/trend?symbols=SOL,USDC&weights=0.7,0.3&range=7d
 *
 * Returns a real composite USD trend for a basket of token symbols, weighted
 * by current allocation. Uses CoinGecko's free /market_chart endpoint —
 * normalizes each token's series to a common timeline, weights, then sums.
 *
 * If symbols/weights aren't provided we fall back to a SOL-only series so
 * the chart still has signal for cold starts.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 60; // cache for a minute on the edge

// CoinGecko id mapping for common Solana ecosystem tokens.
// Anything not in this map is dropped from the basket (with its weight
// redistributed proportionally) — better than guessing.
const CG_ID: Record<string, string> = {
  SOL: "solana",
  WSOL: "solana",
  MSOL: "marinade-staked-sol",
  JITOSOL: "jito-staked-sol",
  BSOL: "blazestake-staked-sol",
  USDC: "usd-coin",
  USDT: "tether",
  JUP: "jupiter-exchange-solana",
  JTO: "jito-governance-token",
  BONK: "bonk",
  WIF: "dogwifcoin",
  PYTH: "pyth-network",
  RAY: "raydium",
  ORCA: "orca",
  WBTC: "wrapped-bitcoin",
  WETH: "weth",
};

interface MarketChartPoint {
  t: number; // unix ms
  usd: number;
}

async function fetchSeries(cgId: string, days: number): Promise<MarketChartPoint[]> {
  const url = new URL(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("days", String(days));
  url.searchParams.set("interval", days <= 1 ? "hourly" : "daily");
  const res = await fetch(url.toString(), { next: { revalidate: 300 } });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as { prices?: [number, number][] } | null;
  if (!json?.prices) return [];
  return json.prices.map(([t, usd]) => ({ t, usd }));
}

/**
 * Resample series onto a uniform timeline of `n` evenly-spaced buckets so
 * different tokens (slightly different timestamps) can be summed cleanly.
 */
function resample(series: MarketChartPoint[], n: number): number[] {
  if (series.length === 0) return new Array(n).fill(0);
  if (series.length === 1) return new Array(n).fill(series[0].usd);
  const t0 = series[0].t;
  const t1 = series[series.length - 1].t;
  const step = (t1 - t0) / (n - 1);
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const targetT = t0 + step * i;
    while (j < series.length - 1 && series[j + 1].t < targetT) j++;
    const a = series[j];
    const b = series[Math.min(j + 1, series.length - 1)];
    if (b.t === a.t) {
      out.push(a.usd);
    } else {
      const ratio = (targetT - a.t) / (b.t - a.t);
      out.push(a.usd + (b.usd - a.usd) * ratio);
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "7d";
  const days = range === "24h" ? 1 : range === "30d" ? 30 : 7;
  const buckets = days <= 1 ? 24 : days * 4; // ~6h granularity for 7d

  // Parse basket
  const symbolsRaw = (searchParams.get("symbols") ?? "SOL").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const weightsRaw = (searchParams.get("weights") ?? "1").split(",").map((w) => Number(w));
  const totalValueParam = Number(searchParams.get("totalValue") ?? "0");

  // Build basket: keep only symbols we can map, redistribute weights.
  const basket: { symbol: string; cgId: string; weight: number }[] = [];
  symbolsRaw.forEach((sym, i) => {
    const cgId = CG_ID[sym];
    const w = weightsRaw[i] ?? 0;
    if (cgId && w > 0) basket.push({ symbol: sym, cgId, weight: w });
  });
  if (basket.length === 0) {
    basket.push({ symbol: "SOL", cgId: "solana", weight: 1 });
  }
  const totalWeight = basket.reduce((s, b) => s + b.weight, 0);
  basket.forEach((b) => (b.weight = b.weight / totalWeight));

  try {
    const seriesList = await Promise.all(basket.map((b) => fetchSeries(b.cgId, days)));
    const resampled = seriesList.map((s) => resample(s, buckets));

    // Composite: weighted basket index, then scale to current total value
    // (so the chart matches the headline number on the right edge).
    const composite: number[] = [];
    for (let i = 0; i < buckets; i++) {
      let v = 0;
      for (let j = 0; j < basket.length; j++) {
        v += (resampled[j][i] ?? 0) * basket[j].weight;
      }
      composite.push(v);
    }

    // Normalize: index of 1.0 at the END, then multiply by totalValue (if known).
    const last = composite[composite.length - 1] || 1;
    const indexed = composite.map((v) => v / last);
    const scaled = totalValueParam > 0 ? indexed.map((v) => v * totalValueParam) : indexed.map((v) => v * 100);

    const first = scaled[0] || 1;
    const changePct = ((scaled[scaled.length - 1] - first) / first) * 100;

    return NextResponse.json(
      {
        range,
        buckets,
        symbols: basket.map((b) => b.symbol),
        weights: basket.map((b) => Number(b.weight.toFixed(4))),
        series: scaled.map((v) => Number(v.toFixed(2))),
        changePct: Number(changePct.toFixed(2)),
        source: "coingecko-composite",
      },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        range,
        series: [],
        changePct: 0,
        source: "error",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }
}
