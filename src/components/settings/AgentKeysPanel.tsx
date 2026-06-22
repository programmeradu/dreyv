"use client";

/**
 * Agent API Keys — real, server-backed, x402-spendable.
 *
 * Each key authenticates an autonomous agent against /api/x402/checkout
 * with `Authorization: Bearer dak_…`. Secrets are revealed exactly once
 * on creation, then only the 12-char prefix is shown.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Bot, Copy, Loader2, Plus, ShieldOff, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { formatDistanceToNow } from "date-fns";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface AgentKey {
    id: string;
    label: string;
    keyPrefix: string;
    scopes: string;
    spendLimitUsd: string | null;
    spentUsd: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
}

export function AgentKeysPanel() {
    const [keys, setKeys] = useState<AgentKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [label, setLabel] = useState("");
    const [spendCap, setSpendCap] = useState<string>("");
    const [newSecret, setNewSecret] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/agent/keys", { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                setKeys(data.keys ?? []);
            }
        } catch {
            // ignored — empty state still renders
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const create = async () => {
        const trimmed = label.trim();
        if (!trimmed) { toast.error("Label is required"); return; }
        setCreating(true);
        try {
            const body: Record<string, unknown> = { label: trimmed };
            const cap = spendCap.trim();
            if (cap) {
                const n = Number(cap);
                if (!Number.isFinite(n) || n <= 0) { toast.error("Spend cap must be a positive number"); setCreating(false); return; }
                body.spendLimitUsd = n;
            }
            const res = await fetch("/api/agent/keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data?.message || data?.error || "Failed to create key");
            } else {
                setNewSecret(data.secret);
                setLabel("");
                setSpendCap("");
                await refresh();
                toast.success("Agent key created — copy the secret now, it will not be shown again.");
            }
        } finally {
            setCreating(false);
        }
    };

    const revoke = async (id: string, lbl: string) => {
        if (!confirm(`Revoke "${lbl}"? Agents using this key will immediately stop working.`)) return;
        const res = await fetch(`/api/agent/keys/${id}`, { method: "DELETE" });
        if (res.ok) {
            await refresh();
            toast.success("Key revoked");
        } else {
            toast.error("Failed to revoke key");
        }
    };

    const copySecret = async () => {
        if (!newSecret) return;
        try {
            await navigator.clipboard.writeText(newSecret);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error("Copy failed — select and copy manually");
        }
    };

    return (
        <section className="rounded-3xl border border-violet-100 bg-white p-6 md:p-8">
            <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                    <div className="mt-1"><DreyvStar size={18} /></div>
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900">Agent API keys</h3>
                        <p className="mt-1 max-w-2xl text-sm text-slate-600">
                            Let autonomous agents pay for Dreyv calls via x402 (USDC on Solana).
                            Issue one key per agent and cap its spend. Use as
                            <code className="mx-1 rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">Authorization: Bearer dak_…</code>
                            against <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">/api/x402/checkout</code>.
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <a
                        href="/app/agent/deliverables"
                        className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-50"
                    >
                        Deliverables
                    </a>
                    <button
                        type="button"
                        onClick={() => { setShowCreate((v) => !v); setNewSecret(null); }}
                        className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
                    >
                        <Plus className="h-4 w-4" /> New agent key
                    </button>
                </div>

            </header>

            {showCreate && !newSecret && (
                <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
                    <div className="grid gap-4 md:grid-cols-[1fr_180px_auto]">
                        <label className="block">
                            <span className="text-xs font-medium uppercase tracking-wide text-violet-700">Label</span>
                            <input
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="e.g. Claude treasury agent (prod)"
                                maxLength={80}
                                className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-violet-500 focus:outline-none"
                            />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium uppercase tracking-wide text-violet-700">Spend cap (USD, optional)</span>
                            <input
                                value={spendCap}
                                onChange={(e) => setSpendCap(e.target.value)}
                                placeholder="e.g. 100"
                                inputMode="decimal"
                                className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-violet-500 focus:outline-none"
                            />
                        </label>
                        <div className="flex items-end">
                            <button
                                type="button"
                                onClick={create}
                                disabled={creating}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-60"
                            >
                                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                                {creating ? "Creating…" : "Create key"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {newSecret && (
                <div className="mt-6 rounded-2xl border-2 border-violet-400 bg-violet-50 p-5">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Copy now — shown once</p>
                            <p className="mt-1 break-all font-mono text-sm text-slate-900">{newSecret}</p>
                        </div>
                        <button
                            type="button"
                            onClick={copySecret}
                            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
                        >
                            {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setNewSecret(null); setShowCreate(false); }}
                        className="mt-4 text-xs font-medium text-violet-700 underline-offset-4 hover:underline"
                    >
                        I&apos;ve stored it safely — dismiss
                    </button>
                </div>
            )}

            <div className="mt-6">
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading keys…
                    </div>
                ) : keys.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/30 p-6 text-sm text-slate-600">
                        No agent keys yet. Create one to let an autonomous agent pay for Dreyv calls.
                    </div>
                ) : (
                    <ul className="divide-y divide-violet-100 overflow-hidden rounded-2xl border border-violet-100 bg-white">
                        {keys.map((k) => {
                            const revoked = !!k.revokedAt;
                            const cap = k.spendLimitUsd ? Number(k.spendLimitUsd) : null;
                            const spent = Number(k.spentUsd ?? 0);
                            const pct = cap && cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : null;
                            return (
                                <li
                                    key={k.id}
                                    className="group flex h-11 items-center gap-3 px-4 text-[12px] hover:bg-violet-50/50"
                                >
                                    <span
                                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${revoked ? "bg-rose-400" : "bg-emerald-500"}`}
                                        aria-hidden
                                    />
                                    <span className="min-w-0 max-w-[28%] truncate font-medium text-slate-900">
                                        {k.label}
                                    </span>
                                    <code className="hidden shrink-0 font-mono text-[11px] text-slate-500 md:inline">
                                        {k.keyPrefix}…
                                    </code>
                                    <span className="ml-auto hidden items-center gap-3 text-[11px] tabular-nums text-slate-500 md:flex">
                                        <span>
                                            ${spent.toFixed(2)}
                                            {cap != null && <span className="text-slate-400"> / ${cap.toFixed(2)}</span>}
                                            {pct != null && (
                                                <span className={`ml-1 ${pct >= 90 ? "text-rose-600" : pct >= 70 ? "text-amber-600" : "text-slate-400"}`}>
                                                    {pct}%
                                                </span>
                                            )}
                                        </span>
                                        <span className="text-slate-300">·</span>
                                        <span>
                                            {k.lastUsedAt
                                                ? formatDistanceToNow(new Date(k.lastUsedAt), { addSuffix: true })
                                                : "never used"}
                                        </span>
                                    </span>
                                    {revoked && (
                                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                                            <ShieldOff className="h-3 w-3" /> revoked
                                        </span>
                                    )}
                                    {!revoked ? (
                                        <button
                                            type="button"
                                            onClick={() => revoke(k.id, k.label)}
                                            aria-label={`Revoke ${k.label}`}
                                            className="shrink-0 rounded-md p-1 text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    ) : (
                                        <span className="w-[22px] shrink-0" aria-hidden />
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </section>
    );
}
