"use client";

// Feature: commandbar-god-mode
// EmptyState shows Dryv's first-glance read of the active treasury.
// We pass the active vault (or signed wallet) to /api/command/starter-prompts;
// the route fetches a thin holdings/activity slice from Helius, hands it to
// Lovable AI, and returns { insight, prompts[5] }. The 5 chips read like
// a to-do list ranked from what Dryv just observed (per Sid feedback).
// Never fabricates numbers — empty wallet → generic seeds + "connect" hint.

import React, { useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { DryvMascot } from "@/components/brand/dryv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { useVault } from "@/lib/contexts/VaultContext";
import { useWallet } from "@/lib/wallet/compat";

interface EmptyStateProps {
  onChipClick: (text: string) => void;
}

interface StarterPrompt {
  label: string;
  text: string;
  pillar: "fees" | "yield" | "risk" | string;
}

const SKELETON: StarterPrompt[] = Array.from({ length: 5 }, (_, i) => ({
  label: "",
  text: "",
  pillar: ["fees", "yield", "risk", "fees", "yield"][i],
}));

export function EmptyState({ onChipClick }: EmptyStateProps) {
  const { activeVault } = useVault();
  const { publicKey } = useWallet();
  const walletAddr = publicKey?.toBase58?.() || null;
  const targetAddress = activeVault || walletAddr || null;
  const targetKind: "vault" | "wallet" | null = activeVault ? "vault" : walletAddr ? "wallet" : null;

  const [prompts, setPrompts] = useState<StarterPrompt[]>(SKELETON);
  const [insight, setInsight] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = targetAddress
      ? `/api/command/starter-prompts?address=${encodeURIComponent(targetAddress)}`
      : `/api/command/starter-prompts`;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (cancelled) return;
        const next = Array.isArray(data?.prompts) ? data.prompts.slice(0, 5) : [];
        if (next.length > 0) setPrompts(next);
        setInsight(typeof data?.insight === "string" ? data.insight : null);
        setAnalyzed(Boolean(data?.analyzed));
      })
      .catch(() => {
        if (!cancelled) {
          setPrompts([{ label: "Get started", text: "What can you do for my treasury?", pillar: "risk" }]);
          setInsight(null);
          setAnalyzed(false);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey, targetAddress]);

  const sourceLabel = analyzed
    ? targetKind === "vault"
      ? "Analyzed your active vault"
      : "Analyzed your wallet"
    : "Suggested to-dos";

  return (
    <div className="flex flex-col gap-6 px-7 pt-8 pb-6">
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <DryvMascot pose="greet" size={56} glow priority alt="Dryv mascot" />
        </div>
        <div className="flex flex-col gap-1 pt-1">
          <h2 className="text-[22px] leading-tight font-semibold tracking-tight text-foreground">
            Hello, I'm <span className="text-violet-600">Dryv</span>.
          </h2>
          <p className="text-sm text-muted-foreground">
            Your treasury copilot — ask me to cut costs, find safer yield, or surface hidden risks.
          </p>
        </div>
      </div>

      {/* Insight block — Dryv's first read of the treasury */}
      <div className="rounded-2xl border border-violet-100 bg-violet-50/40 px-4 py-3.5">
        <div className="flex items-center gap-2 mb-1.5">
          <DreyvStar size={11} className="text-violet-600" />
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-violet-700">
            {loading ? "Reading your treasury…" : sourceLabel}
          </span>
        </div>
        {loading ? (
          <div className="space-y-1.5">
            <div className="h-2.5 w-11/12 rounded bg-violet-100/80 animate-pulse" />
            <div className="h-2.5 w-3/4 rounded bg-violet-100/70 animate-pulse" />
          </div>
        ) : insight ? (
          <p className="text-sm text-slate-800 leading-relaxed">{insight}</p>
        ) : targetAddress ? (
          <p className="text-sm text-slate-600 leading-relaxed">
            Nothing notable on-chain yet — to-dos below are generic until activity shows up.
          </p>
        ) : (
          <p className="text-sm text-slate-600 leading-relaxed">
            Connect a vault or wallet to get a personalized to-do list. Until then these are generic starting points.
          </p>
        )}
      </div>

      {/* To-do chips */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/70">
            {analyzed ? "Suggested to-dos" : "Try one of these"}
          </span>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/70 hover:text-violet-600 transition-colors flex items-center gap-1.5 disabled:opacity-40"
            aria-label="Regenerate to-dos"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Re-analyze
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {prompts.map((cmd, i) => {
            if (loading || !cmd.text) {
              return (
                <div
                  key={`sk-${i}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3.5 py-3 animate-pulse"
                >
                  <DreyvStar size={10} className="shrink-0 text-violet-200" />
                  <div className="flex flex-col gap-1.5 flex-1">
                    <div className="h-2 w-20 rounded bg-violet-100" />
                    <div className="h-2.5 w-3/4 rounded bg-violet-100/70" />
                  </div>
                </div>
              );
            }
            return (
              <button
                key={`${cmd.text}-${i}`}
                type="button"
                onClick={() => onChipClick(cmd.text)}
                className="group flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3.5 py-3 text-left transition-all hover:bg-background hover:shadow-sm hover:border-violet-300"
              >
                <DreyvStar size={10} className="shrink-0 text-violet-600" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {cmd.label}
                  </span>
                  <span className="text-sm text-foreground truncate">{cmd.text}</span>
                </div>
                <ArrowRight
                  size={14}
                  className="text-muted-foreground/40 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all shrink-0"
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
