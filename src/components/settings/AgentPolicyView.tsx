"use client";

/**
 * DACS Phase 3 — Agent Policy settings panel.
 *
 * Compact UI for the per-wallet auto-approve threshold + protocol allow/deny
 * lists + dynamic-write opt-in. Reads/writes /api/dacs/policy.
 */
import React, { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Shield, Loader2, Check, AlertTriangle } from "lucide-react";
import { toast } from "@/lib/toast-notifications";

interface PolicyState {
  autoApproveBelowUsd: number;
  requireMultisigAboveUsd: number | null;
  protocolAllowlist: string[];
  protocolDenylist: string[];
  allowDynamicWrites: boolean;
  dailyValueCapUsd: number | null;
}

const DEFAULT_STATE: PolicyState = {
  autoApproveBelowUsd: 0,
  requireMultisigAboveUsd: null,
  protocolAllowlist: [],
  protocolDenylist: [],
  allowDynamicWrites: false,
  dailyValueCapUsd: null,
};

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function AgentPolicyView() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [state, setState] = useState<PolicyState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allowInput, setAllowInput] = useState("");
  const [denyInput, setDenyInput] = useState("");

  useEffect(() => {
    if (!wallet) return;
    setLoading(true);
    fetch(`/api/dacs/policy?wallet=${wallet}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.policy) {
          const p = data.policy as Partial<PolicyState>;
          const next: PolicyState = {
            autoApproveBelowUsd: Number(p.autoApproveBelowUsd ?? 0),
            requireMultisigAboveUsd:
              p.requireMultisigAboveUsd != null ? Number(p.requireMultisigAboveUsd) : null,
            protocolAllowlist: Array.isArray(p.protocolAllowlist) ? p.protocolAllowlist : [],
            protocolDenylist: Array.isArray(p.protocolDenylist) ? p.protocolDenylist : [],
            allowDynamicWrites: Boolean(p.allowDynamicWrites),
            dailyValueCapUsd:
              p.dailyValueCapUsd != null ? Number(p.dailyValueCapUsd) : null,
          };
          setState(next);
          setAllowInput(next.protocolAllowlist.join(", "));
          setDenyInput(next.protocolDenylist.join(", "));
        }
      })
      .catch(() => toast.error("Could not load agent policy"))
      .finally(() => setLoading(false));
  }, [wallet]);

  const save = async () => {
    if (!wallet) return;
    setSaving(true);
    try {
      const res = await fetch("/api/dacs/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          autoApproveBelowUsd: state.autoApproveBelowUsd,
          requireMultisigAboveUsd: state.requireMultisigAboveUsd,
          protocolAllowlist: parseList(allowInput),
          protocolDenylist: parseList(denyInput),
          allowDynamicWrites: state.allowDynamicWrites,
          dailyValueCapUsd: state.dailyValueCapUsd,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "save_failed");
      toast.success("Agent policy saved");
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!wallet) {
    return (
      <section className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <Shield className="text-primary" size={20} />
          <h2 className="text-lg font-black uppercase tracking-tight">Agent Policy</h2>
        </div>
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
          Connect a wallet to configure your agent guardrails.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
            <Shield size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight">Agent Policy</h2>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
              Guardrails for autonomous execution
            </p>
          </div>
        </div>
        {loading && <Loader2 className="animate-spin text-muted-foreground" size={16} />}
      </div>

      {/* Compact 2-col grid of numeric thresholds */}
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Auto-approve below"
          suffix="USD"
          hint="Plans under this value run without HITL"
          value={state.autoApproveBelowUsd}
          onChange={(v) => setState((s) => ({ ...s, autoApproveBelowUsd: v ?? 0 }))}
        />
        <Field
          label="Require multisig above"
          suffix="USD"
          hint="Force Squads multisig over this"
          value={state.requireMultisigAboveUsd}
          onChange={(v) => setState((s) => ({ ...s, requireMultisigAboveUsd: v }))}
        />
        <Field
          label="Daily value cap"
          suffix="USD"
          hint="Hard ceiling per 24h"
          value={state.dailyValueCapUsd}
          onChange={(v) => setState((s) => ({ ...s, dailyValueCapUsd: v }))}
          className="col-span-2"
        />
      </div>

      {/* Allow / deny lists side by side */}
      <div className="grid grid-cols-2 gap-3">
        <ListField
          label="Allowlist"
          tone="positive"
          placeholder="jupiter, marinade, kamino"
          value={allowInput}
          onChange={setAllowInput}
        />
        <ListField
          label="Denylist"
          tone="negative"
          placeholder="rango, untrusted-dex"
          value={denyInput}
          onChange={setDenyInput}
        />
      </div>

      {/* Dynamic writes toggle */}
      <label className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors">
        <input
          type="checkbox"
          checked={state.allowDynamicWrites}
          onChange={(e) => setState((s) => ({ ...s, allowDynamicWrites: e.target.checked }))}
          className="mt-0.5 w-4 h-4 accent-primary"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-tight">Allow dynamic writes</span>
            {state.allowDynamicWrites && (
              <AlertTriangle size={12} className="text-destructive" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Lets the planner compose new write capabilities at runtime. Off by default.
          </p>
        </div>
      </label>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium truncate max-w-[60%]">
          Wallet · {wallet.slice(0, 4)}…{wallet.slice(-4)}
        </p>
        <button
          onClick={save}
          disabled={saving || loading}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-black uppercase tracking-tight hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save policy
        </button>
      </div>
    </section>
  );
}

function Field({
  label,
  suffix,
  hint,
  value,
  onChange,
  className,
}: {
  label: string;
  suffix?: string;
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={value ?? ""}
          placeholder="—"
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
          className="w-full h-9 px-3 pr-12 rounded-lg bg-background border border-border text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-muted-foreground uppercase tracking-widest">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ListField({
  label,
  tone,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  tone: "positive" | "negative";
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const dot =
    tone === "positive" ? "bg-primary" : "bg-destructive";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {label}
        </label>
      </div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-3 rounded-lg bg-background border border-border text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <p className="text-[10px] text-muted-foreground">Comma-separated protocol ids</p>
    </div>
  );
}
