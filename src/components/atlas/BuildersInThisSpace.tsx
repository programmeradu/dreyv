"use client";

/**
 * BuildersInThisSpace — "Who's shipping in this category?" surface on
 * /atlas token + protocol pages. Backed by Colosseum Copilot search via
 * /api/atlas/colosseum/builders (24h cached).
 *
 * Design rules (per project memory):
 *  - Violet chips only (solid violet-600/100 — no fuchsia, no gradients).
 *  - No dot/bullet glyphs.
 *  - Truncate gracefully; full name is exposed via title= attribute and
 *    chips wrap rather than overflow horizontally on mobile.
 *  - Hidden entirely when upstream returns nothing — never an empty card.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";

interface Builder {
  id: string;
  name: string;
  summary?: string;
  url?: string;
  tags?: string[];
  score?: number;
}

interface ApiResponse {
  query: string;
  builders: Builder[];
  cached?: boolean;
  source?: string;
  note?: string;
  error?: string;
}

export interface BuildersInThisSpaceProps {
  /** Search term (token symbol, protocol slug, vertical). */
  query: string;
  /** Surface label. Defaults to "Builders in this space". */
  title?: string;
  /** Max chips to render. */
  limit?: number;
  /** Optional one-line subtitle override. */
  subtitle?: string;
  /** Visual theme. Light = marketing pages; dark = Atlas detail pages. */
  variant?: "light" | "dark";
  className?: string;
}

const THEMES = {
  light: {
    card: "rounded-2xl border border-violet-200 bg-white p-5 sm:p-6",
    title: "text-sm font-semibold tracking-tight text-violet-900",
    subtitle: "mt-0.5 text-xs text-violet-700/70",
    link: "inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:text-violet-900",
    chip: "inline-flex max-w-[min(18rem,100%)] items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-900 transition hover:border-violet-300 hover:bg-violet-100",
    chipIcon: "h-3 w-3 shrink-0 text-violet-600",
    skel: "h-7 animate-pulse rounded-full bg-violet-100",
  },
  dark: {
    card: "rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6",
    title: "text-xs font-black uppercase tracking-[0.2em] text-white/70",
    subtitle: "mt-1 text-xs text-white/45",
    link: "inline-flex items-center gap-1 text-xs font-medium text-violet-300 hover:text-violet-200",
    chip: "inline-flex max-w-[min(18rem,100%)] items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-100 transition hover:border-violet-300/60 hover:bg-violet-500/20",
    chipIcon: "h-3 w-3 shrink-0 text-violet-300",
    skel: "h-7 animate-pulse rounded-full bg-white/5",
  },
} as const;

export function BuildersInThisSpace({
  query,
  title = "Builders in this space",
  limit = 8,
  subtitle,
  variant = "light",
  className,
}: BuildersInThisSpaceProps) {
  const t = THEMES[variant];
  const [state, setState] = useState<
    | { status: "idle" | "loading" }
    | { status: "ready"; data: ApiResponse }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setState({ status: "ready", data: { query: q, builders: [] } });
      return;
    }
    setState({ status: "loading" });
    const ctrl = new AbortController();
    fetch(`/api/atlas/colosseum/builders?q=${encodeURIComponent(q)}&limit=${limit}`, {
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const json = (await r.json()) as ApiResponse;
        if (cancelled) return;
        setState({ status: "ready", data: json });
      })
      .catch((err) => {
        if (cancelled || err?.name === "AbortError") return;
        setState({ status: "error", message: err?.message ?? "failed" });
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [query, limit]);

  // Hide entirely when no signal — never render an empty/broken card.
  if (state.status === "error") return null;
  if (state.status === "ready" && state.data.builders.length === 0) return null;

  const builders = state.status === "ready" ? state.data.builders : [];
  const loading = state.status === "loading";

  return (
    <section
      className={[t.card, className ?? ""].join(" ")}
      aria-label={title}
    >
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className={t.title}>{title}</h2>
          <p className={t.subtitle}>
            {subtitle ?? `Live from Colosseum builder index — query: "${query}"`}
          </p>
        </div>
        <a
          href={`https://www.colosseum.com/search?q=${encodeURIComponent(query)}`}
          target="_blank"
          rel="noreferrer noopener"
          className={t.link}
        >
          See all on Colosseum
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </header>

      {loading ? (
        <div className="flex flex-wrap gap-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className={t.skel}
              style={{ width: `${72 + ((i * 37) % 72)}px` }}
            />
          ))}
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {builders.map((b) => {
            const label = b.name;
            const chip = (
              <span
                title={b.summary ? `${label} — ${b.summary}` : label}
                className={t.chip}
              >
                <span className="truncate">{label}</span>
                {b.url ? (
                  <ArrowUpRight className={t.chipIcon} aria-hidden />
                ) : null}
              </span>
            );
            return (
              <li key={b.id} className="min-w-0">
                {b.url ? (
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 rounded-full"
                  >
                    {chip}
                  </a>
                ) : (
                  chip
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default BuildersInThisSpace;
