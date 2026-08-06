/**
 * GET /api/news/cryptopanic
 *
 * Aggregates Solana-relevant headlines from free, no-auth public RSS feeds:
 *   • Cointelegraph Solana tag (Solana-specific priority)
 *   • The Block (institutional crypto)
 *   • Decrypt (broad crypto)
 *   • CoinPaprika events (ecosystem events lane)
 *   • CryptoPanic (only if CRYPTOPANIC_TOKEN is set)
 *
 * Path kept as `/api/news/cryptopanic` for backward compatibility.
 * Response: { items: { title, url, source, publishedAt }[] }
 * Cached server-side for 5 minutes.
 */

import { NextResponse } from "next/server";

export const runtime = "edge";

type NewsItem = { title: string; url: string; source: string; publishedAt: string };

let cache: { ts: number; items: NewsItem[] } | null = null;
const TTL_MS = 5 * 60_000;

const FEEDS: { url: string; source: string }[] = [
  { url: "https://cointelegraph.com/rss/tag/solana", source: "Cointelegraph" },
  { url: "https://www.theblock.co/rss.xml", source: "The Block" },
  { url: "https://decrypt.co/feed", source: "Decrypt" },
];

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseRss(xml: string, source: string, limit = 10): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item[\s>][\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRegex) || [];
  for (const block of matches.slice(0, limit)) {
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "";
    const date =
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ??
      block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i)?.[1] ??
      "";
    const cleanTitle = decodeEntities(title);
    const cleanLink = decodeEntities(link);
    if (!cleanTitle || !cleanLink) continue;
    const ts = date ? new Date(decodeEntities(date)).toISOString() : new Date().toISOString();
    items.push({ title: cleanTitle, url: cleanLink, source, publishedAt: ts });
  }
  return items;
}

async function fetchFeed(url: string, source: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        // Some feeds 403 without a UA
        "User-Agent": "Mozilla/5.0 (compatible; AtlasTicker/1.0; +https://dreyv.app)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, source, 8);
  } catch {
    return [];
  }
}

async function fetchPaprikaEvents(): Promise<NewsItem[]> {
  try {
    const res = await fetch("https://api.coinpaprika.com/v1/coins/sol-solana/events", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data: any[] = await res.json();
    const now = Date.now();
    return data
      .filter((e) => e?.name && e?.date)
      .map((e) => ({
        title: e.name as string,
        url: (e.link as string) || "https://coinpaprika.com/coin/sol-solana/",
        source: "Solana Events",
        publishedAt: e.date as string,
        _ts: new Date(e.date).getTime(),
      }))
      .filter((e: any) => {
        const delta = e._ts - now;
        return delta > -30 * 86_400_000 && delta < 90 * 86_400_000;
      })
      .sort((a: any, b: any) => Math.abs(a._ts - now) - Math.abs(b._ts - now))
      .slice(0, 6)
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
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return [];
    const json = await res.json();
    return (json.results || []).slice(0, 8).map((p: any) => ({
      title: p.title,
      url: p.url || "#",
      source: p.source?.title || p.source?.domain || "CryptoPanic",
      publishedAt: p.published_at,
    }));
  } catch {
    return [];
  }
}

const FALLBACK_ITEMS: NewsItem[] = [
  { title: "Atlas live: scan token risk, simulate swaps, and find yield in one place", url: "/atlas", source: "dreyv", publishedAt: new Date().toISOString() },
  { title: "MEV Detector — scan a wallet for sandwich attacks", url: "/atlas#mev-scanner-card", source: "Atlas", publishedAt: new Date().toISOString() },
  { title: "Strategy Lab — backtest yield strategies before deploying capital", url: "/atlas/strategy-lab", source: "Atlas", publishedAt: new Date().toISOString() },
];

function dedupeByTitle(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// Bias the merge so Solana-tagged headlines surface first, then general crypto
function rankSolanaFirst(items: NewsItem[]): NewsItem[] {
  return items
    .map((it) => {
      const t = it.title.toLowerCase();
      const solanaHit = /\bsolana\b|\bsol\b|jupiter|jito|phantom|tensor|drift|marinade|pyth|helium|backpack/.test(t);
      return { it, score: solanaHit ? 1 : 0, ts: new Date(it.publishedAt).getTime() || 0 };
    })
    .sort((a, b) => b.score - a.score || b.ts - a.ts)
    .map((x) => x.it);
}

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return NextResponse.json(
      { items: cache.items },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  }

  const [feedResults, paprika, panic] = await Promise.all([
    Promise.all(FEEDS.map((f) => fetchFeed(f.url, f.source))),
    fetchPaprikaEvents(),
    fetchCryptoPanicIfTokenized(),
  ]);

  const news = dedupeByTitle(rankSolanaFirst(feedResults.flat())).slice(0, 18);
  const merged = [...panic, ...news, ...paprika];
  const items = merged.length > 0 ? merged : FALLBACK_ITEMS;

  cache = { ts: Date.now(), items };
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
