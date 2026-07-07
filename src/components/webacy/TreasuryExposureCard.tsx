"use client";

/**
 * Treasury Exposure card — calls `/api/webacy/exposure` for the active vault
 * and surfaces overall risk + a short list of flagged holdings. Mounted on
 * `/app/treasury`. Auth-gated route: silently hides when unauthenticated or
 * when there is no vault to score. Fail-open.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ShieldAlert, ArrowRight } from "lucide-react";
import { RiskChip } from "@/components/webacy/RiskChip";
import type { WalletExposure } from "@/lib/webacy/service";

interface Props {
  wallet: string | null;
  chain?: string;
}

export function TreasuryExposureCard({ wallet, chain = "sol" }: Props) {
  const [data, setData] = useState<WalletExposure | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error" | "unauth">("idle");

  useEffect(() => {
    if (!wallet) {
      setStatus("idle");
      setData(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch("/api/webacy/exposure", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet, chain }),
        });
        if (res.status === 401) {
          if (!cancelled) setStatus("unauth");
          return;
        }
        const json = (await res.json().catch(() => null)) as WalletExposure | null;
        if (cancelled) return;
        if (!json) {
          setStatus("error");
          return;
        }
        setData(json);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, chain]);

  // Hide entirely when we have nothing meaningful to show — the /app/treasury
  // page already carries a lot of signal. We only surface when scored.
  if (!wallet || status === "unauth" || status === "error") return null;

  const flagged = (data?.holdings ?? []).filter((h) => h.level === "medium" || h.level === "high").slice(0, 4);
  const overallLevel = data?.overall.level ?? "unknown";
  const isClean = status === "ready" && flagged.length === 0 && (overallLevel === "safe" || overallLevel === "safest");

  return (
    <div className="rounded-3xl border border-violet-100 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
            {isClean ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Treasury exposure</h3>
              {data && <RiskChip score={data.overall} size="sm" />}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {status === "loading" && "Scanning holdings for counterparty and contract risk…"}
              {status === "ready" && isClean && "No flagged holdings in this vault. Recheck runs hourly."}
              {status === "ready" && !isClean && (
                <>
                  {data?.flaggedCount} flagged {data?.flaggedCount === 1 ? "holding" : "holdings"} detected by Webacy.
                </>
              )}
            </p>
          </div>
        </div>
        <Link
          href="/app/approvals"
          className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
        >
          Review approvals <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {status === "ready" && flagged.length > 0 && (
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {flagged.map((h) => (
            <li
              key={h.subject}
              className="flex items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-violet-50/40 px-3 py-2"
            >
              <span className="truncate font-mono text-[11px] text-slate-700" title={h.subject}>
                {h.subject.length > 16 ? `${h.subject.slice(0, 6)}…${h.subject.slice(-4)}` : h.subject}
              </span>
              <RiskChip score={h} size="sm" />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[10px] uppercase tracking-[0.14em] text-slate-400">Risk data by Webacy</p>
    </div>
  );
}

export default TreasuryExposureCard;
