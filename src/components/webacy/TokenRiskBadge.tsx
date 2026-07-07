"use client";

/**
 * Client-side token risk badge — fetches `/api/webacy/token` for a mint
 * and renders a `RiskChip`. Fail-open: renders "Unscored" on error.
 */

import { useEffect, useState } from "react";
import { RiskChip } from "./RiskChip";
import type { RiskScore } from "@/lib/webacy/types";

interface TokenRiskBadgeProps {
  mint: string;
  chain?: string;
  size?: "sm" | "md";
  className?: string;
}

export function TokenRiskBadge({ mint, chain = "sol", size = "sm", className }: TokenRiskBadgeProps) {
  const [score, setScore] = useState<RiskScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mint) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/webacy/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mint, chain }),
        });
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.score) setScore(data.score as RiskScore);
      } catch {
        /* fail-open */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mint, chain]);

  if (loading) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-400 ${className ?? ""}`}
        aria-label="Loading Webacy risk"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
        Scoring…
      </span>
    );
  }
  return <RiskChip score={score} size={size} className={className} />;
}

export default TokenRiskBadge;
