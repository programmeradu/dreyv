"use client";

/**
 * Founding 200 ribbon — fetches live claimed count from /api/founding/status
 * and renders a slim violet bar above the pricing tiers. Hides itself once
 * the cap is reached.
 *
 * Visual rules: solid violet only, no gradients, flat surfaces. Matches the
 * approved /pricing aesthetic.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface Status {
  claimed: number;
  remaining: number;
  cap: number;
  open: boolean;
}

export function FoundingRibbon() {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/founding/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setS(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!s || !s.open) return null;
  const pct = Math.min(100, Math.round((s.claimed / s.cap) * 100));

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pb-6">
      <div className="rounded-2xl border border-violet-200 bg-white px-5 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex shrink-0 items-center rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">
            Founding 200
          </span>
          <p className="text-sm text-slate-700 leading-snug">
            First 200 signups get <span className="font-semibold text-slate-900">Mini-tier access free</span> while we onboard design partners.
          </p>
        </div>

        <div className="flex-1 flex items-center gap-3 min-w-[180px]">
          <div className="relative h-1.5 flex-1 rounded-full bg-violet-100 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-violet-600 transition-[width] duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono text-slate-600 whitespace-nowrap tabular-nums">
            {s.claimed} / {s.cap}
          </span>
        </div>

        <Link
          href="/auth"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 transition-colors"
        >
          Claim free Mini
          <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
