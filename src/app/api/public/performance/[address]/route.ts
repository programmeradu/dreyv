export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { getDailyCloseUsd, getSolUsdPrice, getCurrentPricesUsd, COINGECKO_IDS } from "@/lib/explorer/jupiter-price";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const SOL = "So11111111111111111111111111111111111111112";

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "performance", max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const range = Number(new URL(req.url).searchParams.get("range") || "30");
  const days = [30, 90, 365].includes(range) ? range : 30;

  const base = getSiteOrigin();
  const [hres, solSeries] = await Promise.all([
    fetch(`${base}/api/helius/das/wallet-holdings?address=${address}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { holdings: [] })),
    getDailyCloseUsd("solana", days),
  ]);
  const holdings: Array<{ mint: string; balance: string; decimals: number }> = hres?.holdings ?? [];

  // Reconstructed daily USD using *current* balance × historical price.
  // Honest approximation — not perfect lookback but no fabrication.
  const mints = holdings.map((h) => h.mint);
  const [prices, solUsd] = await Promise.all([
    mints.length ? getCurrentPricesUsd(mints) : Promise.resolve({} as Record<string, number>),
    getSolUsdPrice(),
  ]);
  const solCurrent = solUsd ?? prices[SOL] ?? 0;

  // Build a multiplier per day relative to today using the SOL series as a proxy,
  // weighted by the SOL share of the portfolio (most explorers' wallets follow SOL).
  let totalUsd = 0;
  let solUsdComp = 0;
  for (const h of holdings) {
    const dec = h.decimals ?? 0;
    const raw = Number(h.balance ?? 0);
    const ui = dec > 0 ? raw / Math.pow(10, dec) : raw;
    const px = prices[h.mint] ?? (h.mint === SOL ? solCurrent : 0);
    const v = ui * px;
    totalUsd += v;
    if (h.mint === SOL) solUsdComp = v;
  }
  const solShare = totalUsd > 0 ? solUsdComp / totalUsd : 0.5;

  const series = solSeries.map(({ ts, usd }) => {
    const ratio = solCurrent > 0 ? usd / solCurrent : 1;
    // Weighted: SOL share moves with SOL, rest assumed flat in USD.
    const value = totalUsd * (solShare * ratio + (1 - solShare));
    return { ts, value };
  });

  const bench = solSeries.map(({ ts, usd }) => ({ ts, value: usd }));

  return NextResponse.json(
    { range: days, totalUsd, series, bench, approximated: true },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
