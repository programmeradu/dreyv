"use client";

/**
 * AtlasHeaderTicker — CNBC-style live ticker for the Atlas header.
 *
 * Center: continuously left-scrolling marquee combining
 *   • live token prices (from useAtlasData → CORE_TOKENS)
 *   • on-chain events (large Solana network vitals, MEV ping)
 *   • CryptoPanic news headlines (Solana-tagged)
 *
 * Right rail: TPS chip · alerts bell · wallet portfolio chip
 *
 * The marquee uses a simple CSS @keyframes translateX, content is
 * duplicated so the loop is seamless. Pauses on hover.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Bell, Activity, Newspaper, Radio, ExternalLink } from "lucide-react";
import { useAtlasData, CORE_TOKENS } from "@/hooks/use-atlas-data";

type NewsItem = { title: string; url: string; source: string; publishedAt: string };
type Health = { tps: number; slot: number; status: "healthy" | "degraded" | "congested" };

type TickerEntry =
  | { kind: "price"; symbol: string; price: number | null; change: number | null; icon: string }
  | { kind: "news"; title: string; source: string; url: string }
  | { kind: "event"; label: string; value: string; tone: "info" | "warn" | "good" };

function formatPrice(p: number | null): string {
  if (p == null) return "—";
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(6)}`;
}

export function AtlasHeaderTicker() {
  const { prices, solBalance } = useAtlasData();
  const { publicKey } = useWallet();

  const [news, setNews] = useState<NewsItem[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [alertCount] = useState<number>(0); // hook into real alert store later

  // Poll network health every 15s
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/solana/network-health");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setHealth({ tps: data.tps, slot: data.slot, status: data.status });
      } catch {}
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll news every 2 min
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/news/cryptopanic");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setNews(data.items || []);
      } catch {}
    };
    load();
    const id = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Wallet portfolio (rough): SOL balance × SOL price. Future: aggregate all token holdings.
  const portfolioUsd = useMemo(() => {
    if (solBalance == null) return null;
    const solPrice = prices?.["solana"] ?? null;
    if (solPrice == null) return null;
    return solBalance * solPrice;
  }, [solBalance, prices]);

  // Build interleaved ticker entries
  const entries = useMemo<TickerEntry[]>(() => {
    const priceEntries: TickerEntry[] = CORE_TOKENS.map((t) => ({
      kind: "price",
      symbol: t.symbol,
      price: prices?.[t.id] ?? null,
      change: null, // can wire pctChange later
      icon: t.icon,
    }));

    const eventEntries: TickerEntry[] = [];
    if (health) {
      eventEntries.push({
        kind: "event",
        label: "TPS",
        value: health.tps.toLocaleString(),
        tone: health.status === "healthy" ? "good" : health.status === "degraded" ? "info" : "warn",
      });
      eventEntries.push({
        kind: "event",
        label: "SLOT",
        value: health.slot.toLocaleString(),
        tone: "info",
      });
    }

    const newsEntries: TickerEntry[] = news.map((n) => ({
      kind: "news",
      title: n.title,
      source: n.source,
      url: n.url,
    }));

    // Distribute news throughout prices so headlines appear early and often.
    // Pattern: insert a news item after every ~3 prices; sprinkle events every ~5.
    const out: TickerEntry[] = [];
    let newsIdx = 0;
    let evtIdx = 0;
    priceEntries.forEach((p, i) => {
      out.push(p);
      if ((i + 1) % 3 === 0 && newsIdx < newsEntries.length) out.push(newsEntries[newsIdx++]);
      if ((i + 1) % 5 === 0 && evtIdx < eventEntries.length) out.push(eventEntries[evtIdx++]);
    });
    while (newsIdx < newsEntries.length) out.push(newsEntries[newsIdx++]);
    while (evtIdx < eventEntries.length) out.push(eventEntries[evtIdx++]);
    return out;
  }, [prices, news, health]);

  // Black-on-white chip per design; status only conveyed by the tiny dot.
  const tpsDotColor = health
    ? health.status === "healthy"
      ? "bg-emerald-500"
      : health.status === "degraded"
      ? "bg-amber-500"
      : "bg-red-500"
    : "bg-slate-300";

  return (
    <div className="flex flex-1 items-center gap-3 min-w-0">
      {/* TPS status dot — left of ticker, replaces full chip */}
      <div
        className="hidden sm:inline-flex items-center gap-1.5 shrink-0 text-[11px] text-slate-500"
        title={health ? `Solana network: ${health.status} · ${health.tps.toLocaleString()} TPS · slot ${health.slot.toLocaleString()}` : "Loading network health…"}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${tpsDotColor}`} />
      </div>

      {/* Marquee */}
      <div className="relative flex-1 min-w-0 overflow-hidden">
        <div
          className="atlas-ticker-track flex w-max gap-8 whitespace-nowrap py-2"
          style={{ animation: "atlas-ticker-scroll 80s linear infinite" }}
        >
          {[...entries, ...entries].map((e, i) => (
            <div key={i} className="shrink-0">
              <TickerCell entry={e} />
            </div>
          ))}
        </div>
        {/* Edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent" />
      </div>

      {/* Right rail — bell + wallet only */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <button
          type="button"
          aria-label="Alerts"
          className="relative inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-violet-600 hover:bg-violet-50"
        >
          <Bell className="h-3.5 w-3.5" />
          {alertCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
              {alertCount}
            </span>
          )}
        </button>

        {publicKey && (
          <span className="text-[11px] font-medium font-mono text-slate-600" title="Wallet value">
            {portfolioUsd != null
              ? `$${portfolioUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              : solBalance != null
              ? `${solBalance.toFixed(3)} SOL`
              : "—"}
          </span>
        )}
      </div>

      {/* Marquee animation keyframes */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes atlas-ticker-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .atlas-ticker-track:hover { animation-play-state: paused !important; }
      ` }} />
    </div>
  );
}

function TickerCell({ entry }: { entry: TickerEntry }) {
  if (entry.kind === "price") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        {entry.icon && (
          <img
            src={entry.icon}
            alt={entry.symbol}
            className="w-4 h-4 rounded-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <span className="font-semibold text-slate-700">{entry.symbol}</span>
        <span className="font-mono text-slate-900">{formatPrice(entry.price)}</span>
        {entry.change != null && (
          <span className={entry.change >= 0 ? "text-emerald-600" : "text-red-500"}>
            {entry.change >= 0 ? "+" : ""}{entry.change.toFixed(1)}%
          </span>
        )}
      </span>
    );
  }
  if (entry.kind === "event") {
    const toneColor =
      entry.tone === "good" ? "text-emerald-700"
      : entry.tone === "warn" ? "text-red-600"
      : "text-violet-700";
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <Radio className={`h-3 w-3 ${toneColor}`} />
        <span className="font-semibold uppercase tracking-wider text-slate-500 text-[10px]">{entry.label}</span>
        <span className={`font-mono ${toneColor}`}>{entry.value}</span>
      </span>
    );
  }
  // news
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-violet-700 transition-colors"
    >
      <Newspaper className="h-3 w-3 text-violet-500 shrink-0" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600 shrink-0">{entry.source}</span>
      <span className="text-slate-700">{entry.title}</span>
      <ExternalLink className="h-2.5 w-2.5 text-slate-400 shrink-0" />
    </a>
  );
}
