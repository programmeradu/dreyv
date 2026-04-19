/**
 * GET /api/news/cryptopanic
 *
 * Returns a stream of Solana-relevant headlines & ecosystem events for the
 * Atlas header marquee. Uses ONLY free, no-auth public APIs:
 *   • CoinPaprika events for SOL (conferences, governance, protocol updates)
 *   • CryptoPanic public posts (only if CRYPTOPANIC_TOKEN is set, otherwise skipped — their public HTML page is not JSON)
 *
 * Path is kept as `/api/news/cryptopanic` for backward compatibility with
 * the AtlasHeaderTicker, but content is sourced primarily from CoinPaprika.
 *
 * Response: { items: { title, url, source, publishedAt }[] }
 * Cached server-side for 5 minutes.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type NewsItem = { title: string; url: string; source: string; publishedAt: string };

let cache: { ts: number; items: NewsItem[] } | null = null;
const TTL_MS = 5 * 60_000;

async function fetchPaprikaEvents(): Promise<NewsItem[]> {
  try {
    const res = await fetch("https://api.coinpaprika.com/v1/coins/sol-solana/events", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data: any[] = await res.json();
    const now = Date.now();
    return data
      .filter((e) => e?.name && e?.date)
      .map((e) => ({
        title: e.name as string,
        url: (e.link as string) || "https://coinpaprika.com/coin/sol-solana/",
        source: "Solana",
        publishedAt: e.date as string,
        _ts: new Date(e.date).getTime(),
      }))
      // Most relevant: events within the next 90 days or recent past 30 days
      .filter((e: any) => {
        const delta = e._ts - now;
        return delta > -30 * 86_400_000 && delta < 90 * 86_400_000;
      })
      .sort((a: any, b: any) => Math.abs(a._ts - now) - Math.abs(b._ts - now))
      .slice(0, 8)
      .map(({ _ts, ...rest }: any) => rest as NewsItem);
  } catch {
    return [];
  }
}

async function fetchCryptoPanicIfTokenized(): Promise<NewsItem[]> {
  const token = process.env.CRYPTOPANIC_TOKEN;
  if (!token) return [];
  try {
    const url = new URL("https://cryptopanic.com/api/v1/posts/");
    url.searchParams.set("auth_token", token);
    url.searchParams.set("currencies", "SOL");
    url.searchParams.set("kind", "news");
    const res = await fetch(url.toString(), { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return []; // CryptoPanic returns HTML on auth failure
    const json = await res.json();
    return (json.results || []).slice(0, 8).map((p: any) => ({
      title: p.title,
      url: p.url || "#",
      source: p.source?.title || p.source?.domain || "news",
      publishedAt: p.published_at,
    }));
  } catch {
    return [];
  }
}

// Always-on fallback so the marquee never stalls
const FALLBACK_ITEMS: NewsItem[] = [
  { title: "Atlas live: scan token risk, simulate swaps, and find yield in one place", url: "/atlas", source: "dreyv", publishedAt: new Date().toISOString() },
  { title: "MEV Detector — scan a wallet for sandwich attacks", url: "/atlas#mev-scanner-card", source: "Atlas", publishedAt: new Date().toISOString() },
  { title: "Strategy Lab — backtest yield strategies before deploying capital", url: "/atlas/strategy-lab", source: "Atlas", publishedAt: new Date().toISOString() },
];

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return NextResponse.json(
      { items: cache.items },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  }

  const [paprika, panic] = await Promise.all([fetchPaprikaEvents(), fetchCryptoPanicIfTokenized()]);
  const merged = [...panic, ...paprika];
  const items = merged.length > 0 ? merged : FALLBACK_ITEMS;

  cache = { ts: Date.now(), items };
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
