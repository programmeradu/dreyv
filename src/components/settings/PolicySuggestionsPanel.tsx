"use client";

/**
 * DACS Phase 3b — Pending policy suggestions panel.
 *
 * Shown above AgentPolicyView in the /app/settings "Agent Policy" tab.
 * Lists suggestions written by the nightly policy-derivation cron; user
 * can accept (apply + remove) or dismiss (remove only).
 *
 * Styling matches the rest of /app/settings: bg-card, border-border, solid
 * violet primary accent, no gradients (per project memory).
 */

import React, { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet/compat";
import { Check, X, Loader2, TrendingUp, Plus, ShieldOff, ArrowDown } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { toast } from "@/lib/toast-notifications";

interface Suggestion {
  id: string;
  kind:
    | "add_protocol_allowlist"
    | "raise_auto_approve_threshold"
    | "lower_daily_cap"
    | "add_protocol_denylist";
  value: unknown;
  rationale: string;
  confidence: number;
  createdAt: string;
}

const KIND_META: Record<
  Suggestion["kind"],
  { label: string; Icon: typeof Plus; tone: "primary" | "warn" }
> = {
  add_protocol_allowlist: { label: "Add to allowlist", Icon: Plus, tone: "primary" },
  add_protocol_denylist: { label: "Add to denylist", Icon: ShieldOff, tone: "warn" },
  raise_auto_approve_threshold: { label: "Raise auto-approve", Icon: TrendingUp, tone: "primary" },
  lower_daily_cap: { label: "Lower daily cap", Icon: ArrowDown, tone: "warn" },
};

function formatValue(s: Suggestion): string {
  if (s.kind === "add_protocol_allowlist" || s.kind === "add_protocol_denylist") {
    return String(s.value);
  }
  if (typeof s.value === "number") return `$${s.value.toLocaleString()}`;
  return String(s.value ?? "");
}

export function PolicySuggestionsPanel({ onApplied }: { onApplied?: () => void }) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [items, setItems] = useState<Suggestion[]>([]);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dacs/policy/suggestions?wallet=${wallet}`);
      const data = await res.json();
      if (data.ok) {
        setItems(data.suggestions ?? []);
        setLastRun(data.lastDerivationAt ?? null);
      }
    } catch {
      toast.error("Could not load suggestions");
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    load();
  }, [load]);

  const respond = async (id: string, action: "accept" | "dismiss") => {
    if (!wallet) return;
    setBusyId(id);
    try {
      const res = await fetch("/api/dacs/policy/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet, action, id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "failed");
      setItems((prev) => prev.filter((s) => s.id !== id));
      toast.success(action === "accept" ? "Suggestion applied" : "Dismissed");
      if (action === "accept" && data.applied) onApplied?.();
    } catch (err: any) {
      toast.error(err?.message ?? "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  if (!wallet) return null;
  if (!loading && items.length === 0) {
    // Quiet empty state — only render when there's something to act on or a
    // previous derivation timestamp to show.
    if (!lastRun) return null;
    return (
      <section className="bg-card border border-border rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
            <Sparkles size={16} />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-tight">Policy suggestions</h3>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
              No new suggestions · Last review {new Date(lastRun).toLocaleDateString()}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4 relative overflow-hidden">
      {/* Ambient violet glow per design system (no gradients, just subtle radial) */}
      <div
        aria-hidden
        className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-primary/5 pointer-events-none"
      />

      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight">Policy Suggestions</h2>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
              Derived from your recent approvals
            </p>
          </div>
        </div>
        {loading && <Loader2 className="animate-spin text-muted-foreground" size={16} />}
      </div>

      <ul className="space-y-2 relative z-10">
        {items.map((s) => {
          const meta = KIND_META[s.kind];
          const Icon = meta.Icon;
          const toneRing = meta.tone === "primary" ? "border-primary/20" : "border-destructive/20";
          const toneBg = meta.tone === "primary" ? "bg-primary/5" : "bg-destructive/5";
          const toneText = meta.tone === "primary" ? "text-primary" : "text-destructive";
          return (
            <li
              key={s.id}
              className={`flex items-start gap-3 p-3 rounded-xl border ${toneRing} ${toneBg}`}
            >
              <div
                className={`shrink-0 w-8 h-8 rounded-lg bg-background border ${toneRing} flex items-center justify-center ${toneText}`}
              >
                <Icon size={14} />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    {meta.label}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-background border border-border text-[10px] font-black font-mono text-foreground">
                    {formatValue(s)}
                  </span>
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {(s.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
                <p className="text-xs text-foreground leading-relaxed">{s.rationale}</p>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => respond(s.id, "accept")}
                  disabled={busyId === s.id}
                  aria-label="Accept suggestion"
                  className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition disabled:opacity-50"
                >
                  {busyId === s.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => respond(s.id, "dismiss")}
                  disabled={busyId === s.id}
                  aria-label="Dismiss suggestion"
                  className="w-8 h-8 rounded-lg bg-background border border-border text-muted-foreground flex items-center justify-center hover:text-foreground hover:border-primary/30 transition disabled:opacity-50"
                >
                  <X size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {lastRun && (
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium relative z-10">
          Last review · {new Date(lastRun).toLocaleString()}
        </p>
      )}
    </section>
  );
}
