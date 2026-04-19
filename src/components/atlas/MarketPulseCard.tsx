"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { pctChange } from "@/lib/atlas-utils";
import { Sparkline, SparklineArea, SparkBars, SparkHeatmap, SparkCandles } from "./Sparkline";
import { IconMarketPulse } from "@/components/ui/icons";
import { WidgetInfo } from "./WidgetInfo";

type CoreToken = { id: string; symbol: string; icon: string; mint?: string };
type TrendingToken = { mint: string; symbol: string; name?: string; icon?: string; logoURI?: string };

interface MarketPulseCardProps {
  coreTokens: CoreToken[];
  prices: Record<string, number>;
  coreHistory: Record<string, number[]>;
  pricesLoading: boolean;
  pricesUpdatedAt: number | null;
  refreshPrices: () => void;
  trending: TrendingToken[];
  trendingPrices: Record<string, number>;
  trendingHist: Record<string, number[]>;
  trendingUpdatedAt: number | null;
  trendingLoading: boolean;
  trendingError: string | null;
  trendingSource: "bitquery" | "jupiter" | "moralis";
}

export function MarketPulseCard({
  coreTokens,
  prices,
  coreHistory,
  pricesLoading,
  pricesUpdatedAt,
  refreshPrices,
  trending,
  trendingPrices,
  trendingHist,
  trendingUpdatedAt,
  trendingLoading,
  trendingError,
  trendingSource,
}: MarketPulseCardProps) {
  return (
    <div className="h-full">
      <Card className="atlas-card relative overflow-hidden h-full flex flex-col border-border/50 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 transition-colors hover:border-foreground/20 hover:shadow-[0_6px_24px_-12px_rgba(0,0,0,0.25)]">
        <span className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-[radial-gradient(closest-side,var(--color-accent)/35%,transparent_70%)]" />
        <CardHeader className="pb-2 pt-1 flex items-center justify-between gap-2 relative">
          <span className="pointer-events-none absolute inset-x-3 -top-px h-px bg-[linear-gradient(to_right,transparent,theme(colors.border),transparent)] opacity-60" />
          <CardTitle className="text-sm leading-none">
            <span className="flex items-center gap-2"><IconMarketPulse className="h-4 w-4" /><span>Market Pulse</span></span>
          </CardTitle>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={refreshPrices}
              disabled={pricesLoading}
              aria-label="Refresh prices"
              title="Refresh prices (R)"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground hover:bg-muted/40 disabled:opacity-50"
            >
              {pricesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
            <WidgetInfo
              source="Jupiter price feed"
              updatedAt={pricesUpdatedAt}
              methodology="Mid prices for the 10 core Solana tokens, refreshed every minute. Sparklines show the last hour."
              methodologyHref="https://station.jup.ag/docs/apis/price-api"
            />
          </div>
        </CardHeader>
        <CardContent className="atlas-card-content pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
            {coreTokens.map((t) => (
              <PriceCell
                key={t.id}
                symbol={t.symbol}
                icon={t.icon}
                mint={t.mint}
                price={prices[t.id]}
                history={coreHistory[t.id] || []}
              />
            ))}
          </div>

          {/* Trending */}
          <div className="mt-4">
            <div className="flex items-center justify-between px-1 mb-2">
              <div className="text-[11px] opacity-70">Trending</div>
              <div className="flex items-center gap-2">
              <WidgetInfo
                source={trendingSource === "moralis" ? "Moralis" : trendingSource === "bitquery" ? "Bitquery" : "Jupiter"}
                updatedAt={trendingUpdatedAt}
                methodology="Top Solana tokens by recent volume and momentum from the active data source. Updates every minute."
              />
              </div>
            </div>

            {trendingLoading && (
              <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>
            )}
            {trendingError && (
              <Alert variant="destructive"><AlertDescription>{trendingError}</AlertDescription></Alert>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {trending.map((t) => {
                const tp = trendingPrices[t.mint];
                const hist = trendingHist[t.mint] || [];
                const d = pctChange(hist);
                const up = d != null && d >= 0;
                return (
                  <div key={t.mint} className="relative overflow-hidden rounded-md bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/40 px-3 py-2 transition-colors group">
                    <span className="pointer-events-none absolute -top-8 -right-8 h-16 w-16 rounded-full bg-[radial-gradient(closest-side,var(--color-accent)/25%,transparent_70%)]" />
                    <span className="pointer-events-none absolute -inset-px rounded-md opacity-0 group-hover:opacity-100 transition-opacity [background:conic-gradient(from_0deg,transparent,theme(colors.accent)/25%,transparent_50%,transparent)] animate-[spin_10s_linear_infinite]" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="opacity-70 inline-flex items-center gap-1.5 shrink-0">
                        <TokenIcon key={t.mint} icon={t.icon} symbol={t.symbol} mint={t.mint} />
                        <span>{t.symbol}</span>
                      </span>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono truncate cursor-pointer select-none" title="Click to copy"
                          onClick={() => { if (tp != null) { navigator.clipboard.writeText(formatPrice(tp)); toast.success(`${t.symbol} price copied`); } }}>
                          {tp != null ? `$${formatPrice(tp)}` : <Skeleton className="h-3 w-14" />}
                        </span>
                        {d != null && (
                          <span className={`shrink-0 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${up ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"}`}>
                            <ChangeArrow up={up} />{`${up ? "+" : ""}${d.toFixed(1)}%`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 text-foreground/60 h-5">
                      <Sparkline data={hist} height={20} />
                    </div>
                  </div>
                );
              })}
              {!trendingLoading && !trendingError && trending.length === 0 && (
                <div className="text-xs opacity-70">No trending tokens found right now.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Small helper: up/down arrow SVG
function ChangeArrow({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden>
      {up
        ? <path d="M5 14l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M5 10l7 7 7-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      }
    </svg>
  );
}

// Format price with appropriate precision: ≥1 → 2dp, <1 → up to 8dp (no trailing zeros)
function formatPrice(p: number): string {
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0");
}

// Chart variant assignment — each style distributed across all 10 core tokens
const VIZ_MAP: Record<string, "area" | "bars" | "heatmap" | "candles"> = {
  SOL: "area",
  mSOL: "bars",
  jitoSOL: "candles",
  bSOL: "heatmap",
  USDC: "heatmap",
  JUP: "candles",
  BONK: "candles",
  PYTH: "area",
  RAY: "heatmap",
  ORCA: "bars",
};

// DRY price cell for all core tokens — horizontal spread layout
function PriceCell({ symbol, icon, mint, price, history }: { symbol: string; icon?: string; mint?: string; price?: number; history: number[] }) {
  const d = pctChange(history);
  const up = d != null && d >= 0;
  const viz = VIZ_MAP[symbol];
  return (
    <div className="relative overflow-hidden rounded-md bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/40 px-3 py-2 transition-colors group">
      <span className="pointer-events-none absolute -top-8 -right-8 h-16 w-16 rounded-full bg-[radial-gradient(closest-side,var(--color-accent)/25%,transparent_70%)]" />
      <span className="pointer-events-none absolute -inset-px rounded-md opacity-0 group-hover:opacity-100 transition-opacity [background:conic-gradient(from_0deg,transparent,theme(colors.accent)/25%,transparent_50%,transparent)] animate-[spin_10s_linear_infinite]" />
      <div className="flex items-center justify-between gap-2">
        <span className="opacity-70 inline-flex items-center gap-1.5 shrink-0">
          <TokenIcon key={symbol} icon={icon} symbol={symbol} mint={mint} rounded="full" />
          <span>{symbol}</span>
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono truncate cursor-pointer select-none" title="Click to copy"
            onClick={() => { if (price) { navigator.clipboard.writeText(formatPrice(price)); toast.success(`${symbol} price copied`); } }}>
            {price != null ? `$${formatPrice(price)}` : <Skeleton className="h-3 w-14" />}
          </span>
          {d != null && (
            <span className={`shrink-0 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] leading-none ${up ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"}`}>
              <ChangeArrow up={up} />{`${up ? "+" : ""}${d.toFixed(1)}%`}
            </span>
          )}
        </div>
      </div>
      {/* Chart area — variant or default sparkline */}
      <div className="mt-1 h-5">
        {viz === "area" ? (
          <SparklineArea data={history} height={20} />
        ) : viz === "bars" ? (
          <SparkBars data={history} height={20} />
        ) : viz === "heatmap" ? (
          <SparkHeatmap data={history} />
        ) : viz === "candles" ? (
          <SparkCandles data={history} height={20} />
        ) : (
          <span className="text-foreground/60"><Sparkline data={history} height={20} /></span>
        )}
      </div>
    </div>
  );
}

// Token icon with multi-source fallback chain — tries several reliable
// CDNs/APIs so a logo always renders. Sources tried in order:
//   1. Provided icon URL (Jupiter / Moralis / Bitquery)
//   2. Jupiter strict token list CDN by mint
//   3. Solana token-list (raw.githubusercontent) by mint
//   4. DexScreener token image by mint
//   5. CoinGecko coin image by symbol (best-effort)
//   6. logo.dev branded fallback by symbol
function buildIconChain(icon: string | undefined, mint: string | undefined, symbol: string): string[] {
  const chain: string[] = [];
  const push = (u?: string) => { if (u && !chain.includes(u)) chain.push(u); };
  // Normalize ipfs:// → public gateway
  const norm = (u?: string) => u?.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${u.slice(7)}` : u;
  push(norm(icon));
  if (mint) {
    push(`https://static.jup.ag/tokens/${mint}.png`);
    push(`https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/${mint}/logo.png`);
    // DexScreener canonical CDN (no redirect)
    push(`https://cdn.dexscreener.com/tokens/solana/${mint}.png`);
    push(`https://img-v1.raydium.io/icon/${mint}.png`);
  }
  const sym = symbol.toLowerCase();
  // logo.dev — branded fallback (crypto + ticker endpoints)
  push(`https://img.logo.dev/crypto/${sym}?token=pk_DFEjHHL4QteaMOzcFuSlwg`);
  push(`https://img.logo.dev/ticker/${sym}?token=pk_DFEjHHL4QteaMOzcFuSlwg`);
  return chain;
}

function TokenIcon({ icon, symbol, mint, rounded = "md" }: { icon?: string; symbol: string; mint?: string; rounded?: "md" | "full" }) {
  // Build chain ONCE per mount — don't rebuild on parent re-renders.
  // Parent must pass a stable `key` (e.g. mint) so a new token = new TokenIcon.
  const chain = useMemo(() => buildIconChain(icon, mint, symbol), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [idx, setIdx] = useState(0);
  const cls = rounded === "full" ? "rounded-full" : "rounded";
  const src = chain[idx];
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`h-4 w-4 ${cls} object-cover bg-muted shrink-0`}
        onError={() => setIdx((i) => i + 1)}
      />
    );
  }
  // Last resort — deterministic colored letter (should rarely trigger).
  const hue = Array.from(symbol).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <span
      aria-hidden
      className={`h-4 w-4 ${cls} inline-flex items-center justify-center text-[8px] font-bold text-white shrink-0`}
      style={{ background: `hsl(${hue} 70% 45%)` }}
    >
      {symbol.charAt(0).toUpperCase()}
    </span>
  );
}
