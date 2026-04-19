/**
 * GET /api/news/cryptopanic
 *
 * Returns recent Solana-related crypto news headlines from CryptoPanic's free
 * public feed (no auth required for the public RSS-style JSON endpoint).
 *
 * Response: { items: { title, url, source, publishedAt }[] }
 *
 * Cached server-side for 2 minutes.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type NewsItem = { title: string; url: string; source: string; publishedAt: string };

let cache: { ts: number; items: NewsItem[] } | null = null;
const TTL_MS = 120_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return NextResponse.json(
      { items: cache.items },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
    );
  }

  // Public free endpoint (no auth_token required for limited access).
  // If CRYPTOPANIC_TOKEN is configured, include it for higher limits.
  const token = process.env.CRYPTOPANIC_TOKEN;
  const url = new URL("https://cryptopanic.com/api/v1/posts/");
  if (token) url.searchParams.set("auth_token", token);
  url.searchParams.set("currencies", "SOL");
  url.searchParams.set("public", "true");
  url.searchParams.set("kind", "news");

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`CryptoPanic ${res.status}`);
    const json = await res.json();
    const items: NewsItem[] = (json.results || []).slice(0, 12).map((p: any) => ({
      title: p.title,
      url: p.url || p.source?.domain ? `https://${p.source?.domain}` : "#",
      source: p.source?.title || p.source?.domain || "news",
      publishedAt: p.published_at,
    }));
    cache = { ts: Date.now(), items };
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
    );
  } catch (err: any) {
    // Graceful fallback so the ticker never breaks
    const fallback: NewsItem[] = [
      { title: "Solana network running smoothly — check Atlas Market Pulse for live data", url: "/atlas#market-pulse-card", source: "Atlas", publishedAt: new Date().toISOString() },
    ];
    return NextResponse.json({ items: fallback, error: err.message }, { status: 200 });
  }
}
