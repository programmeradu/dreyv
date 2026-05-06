"use client";

/**
 * DACS Phase 3 — Agent Policy settings panel (Stitch-light Dreyv aesthetic).
 *
 * Per-wallet auto-approve threshold, multisig escalation, daily cap, protocol
 * allow/deny lists, dynamic-write opt-in. Reads/writes /api/dacs/policy.
 */
import React, { useEffect, useState, useMemo } from "react";
import { useWallet } from "@/lib/wallet/compat";
import { Loader2, Check, AlertTriangle, ShieldCheck, Gauge, ListChecks, Ban } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { DreyvStar } from "@/components/studio/DreyvStar";

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
  return value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
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
            requireMultisigAboveUsd: p.requireMultisigAboveUsd != null ? Number(p.requireMultisigAboveUsd) : null,
            protocolAllowlist: Array.isArray(p.protocolAllowlist) ? p.protocolAllowlist : [],
            protocolDenylist: Array.isArray(p.protocolDenylist) ? p.protocolDenylist : [],
            allowDynamicWrites: Boolean(p.allowDynamicWrites),
            dailyValueCapUsd: p.dailyValueCapUsd != null ? Number(p.dailyValueCapUsd) : null,
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

  // Derived posture summary — gives a clear "what's enforced" line.
  const posture = useMemo(() => {
    const parts: string[] = [];
    if (state.autoApproveBelowUsd > 0)
      parts.push(`auto-sign < $${state.autoApproveBelowUsd.toLocaleString()}`);
    else parts.push("manual approval on every action");
    if (state.requireMultisigAboveUsd)
      parts.push(`Squads ≥ $${state.requireMultisigAboveUsd.toLocaleString()}`);
    if (state.dailyValueCapUsd)
      parts.push(`daily cap $${state.dailyValueCapUsd.toLocaleString()}`);
    return parts.join(" · ");
  }, [state]);

  if (!wallet) {
    return (
      <section className="rounded-3xl border border-violet-100 bg-white p-7">
        <div className="flex items-center gap-2.5 mb-2">
          <DreyvStar size={10} className="text-violet-600" />
          <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Agent policy</span>
        </div>
        <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-slate-900">Connect a wallet to set guardrails</h2>
        <p className="mt-1 text-[13px] text-slate-500">Policies are stored per wallet — every signing key gets its own envelope.</p>
      </section>
    );
  }

  return (
    <section className="relative rounded-3xl border border-violet-100 bg-white p-7 sm:p-8 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-violet-300/20 blur-3xl" />

      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <DreyvStar size={10} className="text-violet-600" />
            <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Agent policy</span>
          </div>
          <h2 className="mt-2 text-[24px] sm:text-[26px] font-semibold tracking-[-0.01em] text-slate-900">
            Guardrails for <span className="italic font-light text-violet-600">autonomous</span> execution
          </h2>
          <p className="mt-1 text-[13px] text-slate-500 max-w-xl">
            Thresholds the agent honors before signing on your behalf. Anything outside this envelope is escalated to you (or to Squads).
          </p>
        </div>
        {loading && <Loader2 className="animate-spin text-violet-600" size={16} />}
      </div>

      {/* Posture strip */}
      <div className="relative z-10 mt-5 rounded-2xl border border-violet-100 bg-violet-50/40 px-4 py-3 flex items-center gap-3">
        <span className="h-8 w-8 rounded-xl bg-white border border-violet-100 flex items-center justify-center text-violet-600 shrink-0">
          <ShieldCheck size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Current posture</p>
          <p className="text-[12px] text-slate-700 font-mono truncate">{posture}</p>
        </div>
      </div>

      {/* Thresholds */}
      <div className="relative z-10 mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          icon={Gauge}
          label="Auto-approve below"
          suffix="USD"
          hint="Plans under this value run without HITL"
          value={state.autoApproveBelowUsd}
          onChange={(v) => setState((s) => ({ ...s, autoApproveBelowUsd: v ?? 0 }))}
        />
        <Field
          icon={ShieldCheck}
          label="Require multisig above"
          suffix="USD"
          hint="Force Squads multisig over this"
          value={state.requireMultisigAboveUsd}
          onChange={(v) => setState((s) => ({ ...s, requireMultisigAboveUsd: v }))}
        />
        <Field
          icon={Gauge}
          label="Daily value cap"
          suffix="USD"
          hint="Hard ceiling per rolling 24h"
          value={state.dailyValueCapUsd}
          onChange={(v) => setState((s) => ({ ...s, dailyValueCapUsd: v }))}
          className="sm:col-span-2"
        />
      </div>

      {/* Allow / deny */}
      <div className="relative z-10 mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ListField
          icon={ListChecks}
          label="Allowlist"
          tone="positive"
          placeholder="jupiter, marinade, kamino"
          value={allowInput}
          onChange={setAllowInput}
        />
        <ListField
          icon={Ban}
          label="Denylist"
          tone="negative"
          placeholder="rango, untrusted-dex"
          value={denyInput}
          onChange={setDenyInput}
        />
      </div>

      {/* Dynamic writes */}
      <label className="relative z-10 mt-4 flex items-start gap-3 p-4 rounded-2xl border border-violet-100 bg-white hover:border-violet-300 transition cursor-pointer">
        <input
          type="checkbox"
          checked={state.allowDynamicWrites}
          onChange={(e) => setState((s) => ({ ...s, allowDynamicWrites: e.target.checked }))}
          className="mt-0.5 h-4 w-4 accent-violet-600"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-900">Allow dynamic writes</span>
            {state.allowDynamicWrites && <AlertTriangle size={12} className="text-amber-600" />}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            Lets the planner compose new write capabilities at runtime. Off by default — keeps the surface area small.
          </p>
        </div>
      </label>

      {/* Footer */}
      <div className="relative z-10 mt-6 pt-5 border-t border-violet-100 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[11px] text-slate-500 font-mono">
          Wallet · {wallet.slice(0, 6)}…{wallet.slice(-4)}
        </p>
        <button
          onClick={save}
          disabled={saving || loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold transition disabled:opacity-50 shadow-[0_12px_30px_-12px_rgba(124,58,237,0.6)]"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save policy
        </button>
      </div>
    </section>
  );
}

function Field({
  icon: Icon, label, suffix, hint, value, onChange, className,
}: {
  icon?: any;
  label: string;
  suffix?: string;
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-violet-100 bg-white p-4 ${className ?? ""}`}>
      <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-slate-500">
        {Icon && <Icon size={11} className="text-violet-600" />}
        {label}
      </label>
      <div className="relative mt-2">
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
          className="w-full h-11 px-3.5 pr-14 rounded-xl bg-violet-50/40 border border-violet-100 focus:border-violet-400 focus:bg-white text-[15px] font-mono text-slate-900 transition outline-none"
        />
        {suffix && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold tracking-[0.18em] text-slate-400 uppercase">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function ListField({
  icon: Icon, label, tone, placeholder, value, onChange,
}: {
  icon?: any;
  label: string;
  tone: "positive" | "negative";
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const accent = tone === "positive" ? "text-violet-600" : "text-rose-500";
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4">
      <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-slate-500">
        {Icon && <Icon size={11} className={accent} />}
        {label}
      </div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full h-11 px-3.5 rounded-xl bg-violet-50/40 border border-violet-100 focus:border-violet-400 focus:bg-white text-[13px] font-mono text-slate-900 transition outline-none"
      />
      <p className="mt-1.5 text-[11px] text-slate-500">Comma-separated protocol ids</p>
    </div>
  );
}
