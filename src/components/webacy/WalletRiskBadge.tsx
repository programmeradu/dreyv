"use client";

/**
 * Client-side wallet risk badge — POSTs `/api/webacy/address` (Contract Risk +
 * Threat Risks merged) for a given address and renders a `RiskChip`. Silent /
 * fail-open. Debounces to avoid firing on every keystroke.
 */

import { useEffect, useState } from "react";
import { RiskChip } from "./RiskChip";
import type { RiskScore } from "@/lib/webacy/types";

interface WalletRiskBadgeProps {
  address: string;
  chain?: string;
  size?: "sm" | "md";
  className?: string;
  /** Skip render entirely while loading (used inline where a placeholder would look odd). */
  hideWhileLoading?: boolean;
}

export function WalletRiskBadge({
  address,
  chain = "sol",
  size = "sm",
  className,
  hideWhileLoading = false,
}: WalletRiskBadgeProps) {
  const [score, setScore] = useState<RiskScore | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!address || address.length < 20) {
      setStatus("idle");
      setScore(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/webacy/address", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ addresses: [address], chain }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        const scoresMap = data?.scores && typeof data.scores === "object" ? (data.scores as Record<string, RiskScore>) : null;
        const first = scoresMap ? scoresMap[address] ?? Object.values(scoresMap)[0] : null;
        if (first) {
          setScore(first);
          setStatus("ready");
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [address, chain]);

  if (status === "idle" || status === "error") return null;
  if (status === "loading") {
    if (hideWhileLoading) return null;
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-400 ${className ?? ""}`}
        aria-label="Loading Webacy risk"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
        Scoring…
      </span>
    );
  }
  return <RiskChip score={score} size={size} className={className} />;
}

export default WalletRiskBadge;
