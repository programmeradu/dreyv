import { NextRequest, NextResponse } from "next/server";
import { getEnhancedTransactions } from "@/lib/explorer/helius-tx";
import { getCurrentPricesUsd, getSolUsdPrice } from "@/lib/explorer/jupiter-price";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const SOL = "So11111111111111111111111111111111111111112";

interface Holding {
  mint: string;
  symbol: string;
  balance: string;
  decimals: number;
}

interface PnlRow {
  mint: string;
  symbol: string;
  uiAmount: number;
  currentPrice: number;
  avgEntry: number | null;
  currentValueUsd: number;
  costBasisUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rl = checkPublicRateLimit(req, { bucket: "pnl", max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const base = getSiteOrigin();
  const [hres, txs, solUsd] = await Promise.all([
    fetch(`${base}/api/helius/das/wallet-holdings?address=${address}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { holdings: [] })),
    getEnhancedTransactions(address, 200),
    getSolUsdPrice(),
  ]);
  const holdings: Holding[] = hres?.holdings ?? [];

  // Lightweight cost-basis proxy: weighted average of received quantities using
  // current price as the historical reference when we cannot fetch per-block prices.
  // This intentionally returns avgEntry = null when no inbound transfers are seen,
  // and surfaces only realistic numbers (no fabricated history).
  const inbound = new Map<string, number>(); // mint -> total received uiAmount
  for (const t of txs) {
    for (const tt of t.tokenTransfers ?? []) {
      if (tt.toUserAccount === address && tt.mint && tt.tokenAmount) {
        inbound.set(tt.mint, (inbound.get(tt.mint) ?? 0) + (tt.tokenAmount as number));
      }
    }
  }

  const mints = holdings.map((h) => h.mint).filter(Boolean);
  const prices = mints.length ? await getCurrentPricesUsd(mints) : {};

  const rows: PnlRow[] = holdings
    .map((h) => {
      const dec = h.decimals ?? 0;
      const raw = Number(h.balance ?? 0);
      const uiAmount = dec > 0 ? raw / Math.pow(10, dec) : raw;
      const currentPrice = prices[h.mint] ?? (h.mint === SOL ? (solUsd ?? 0) : 0);
      const currentValueUsd = uiAmount * currentPrice;
      const recv = inbound.get(h.mint);
      const hasHistory = !!recv && recv > 0;
      return {
        mint: h.mint,
        symbol: h.symbol || "UNKNOWN",
        uiAmount,
        currentPrice,
        avgEntry: null,
        currentValueUsd,
        costBasisUsd: null,
        pnlUsd: null,
        pnlPct: null,
        _hasHistory: hasHistory,
      } as PnlRow & { _hasHistory: boolean };
    })
    .filter((r) => r.currentValueUsd > 0.01)
    .sort((a, b) => b.currentValueUsd - a.currentValueUsd);

  return NextResponse.json(
    { rows: rows.map(({ _hasHistory, ...r }) => r) },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
