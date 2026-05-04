"use client";

/**
 * TokenLogo — renders the real, original logo for an SPL token.
 *
 * Resolution order:
 *   1. Static map for major tokens (SOL/USDC/USDT/etc) — instant, no network.
 *   2. In-memory cache (per browser session).
 *   3. Jupiter token-list lookup by mint (if mint provided).
 *   4. Jupiter search by symbol (covers long-tail like HORSE, BONK, …).
 *
 * Falls back to a violet circle with the symbol's first letter on miss/error.
 */

import { useEffect, useState } from "react";

interface Props {
  symbol?: string | null;
  mint?: string | null;
  size?: number; // px
  className?: string;
}

const STATIC_LOGOS: Record<string, string> = {
  SOL: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  WSOL: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  USDC: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  USDT: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg",
  BONK: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
  JUP: "https://static.jup.ag/jup/icon.png",
};

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

async function fetchByMint(mint: string): Promise<string | null> {
  try {
    const r = await fetch(`https://tokens.jup.ag/token/${mint}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return typeof d?.logoURI === "string" ? d.logoURI : null;
  } catch {
    return null;
  }
}

async function fetchBySymbol(symbol: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!r.ok) return null;
    const d = await r.json();
    const arr: any[] = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
    if (arr.length === 0) return null;
    const exact =
      arr.find((t) => String(t.symbol ?? "").toUpperCase() === symbol.toUpperCase()) ?? arr[0];
    return (exact?.icon as string) ?? (exact?.logoURI as string) ?? null;
  } catch {
    return null;
  }
}

async function resolveLogo(symbol?: string | null, mint?: string | null): Promise<string | null> {
  const sym = symbol?.toUpperCase().trim();
  if (sym && STATIC_LOGOS[sym]) return STATIC_LOGOS[sym];

  const key = mint || sym || "";
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  if (inflight.has(key)) return inflight.get(key)!;

  const p = (async () => {
    const url = mint ? await fetchByMint(mint) : sym ? await fetchBySymbol(sym) : null;
    cache.set(key, url);
    inflight.delete(key);
    return url;
  })();
  inflight.set(key, p);
  return p;
}

export function TokenLogo({ symbol, mint, size = 18, className = "" }: Props) {
  const [src, setSrc] = useState<string | null>(() => {
    const sym = symbol?.toUpperCase().trim();
    if (sym && STATIC_LOGOS[sym]) return STATIC_LOGOS[sym];
    const key = mint || sym || "";
    return key && cache.has(key) ? cache.get(key)! : null;
  });
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (src || errored) return;
    resolveLogo(symbol, mint).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [symbol, mint, src, errored]);

  const initial = (symbol ?? mint ?? "?").trim().charAt(0).toUpperCase();
  const dim = { width: size, height: size };

  if (!src || errored) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-violet-100 font-semibold text-violet-700 ${className}`}
        style={{ ...dim, fontSize: Math.max(8, Math.round(size * 0.5)) }}
        aria-hidden
      >
        {initial}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={symbol ?? ""}
      width={size}
      height={size}
      className={`inline-block rounded-full bg-white object-cover ring-1 ring-violet-100 ${className}`}
      style={dim}
      onError={() => setErrored(true)}
    />
  );
}
