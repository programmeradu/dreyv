/**
 * /app/admin/traces — Phase 8 observability dashboard.
 *
 * Reads `agent_tool_metrics` via `/api/admin/traces` and shows per-capability
 * latency / error rate / cost, plus circuit-breaker state and a recent event tail.
 * Brand: light, manrope, solid violet — matches /app/admin.
 */
"use client";

import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, RefreshCw, Server, Shield } from "lucide-react";
import { useDeclareFocus } from "@/lib/commandbar/focus-context";

type CapRow = { capabilityId: string; runs: number; errors: number; denied: number; avgMs: number; p95Ms: number; costUsd: number };
type Event = { id: string; capabilityId: string; latencyMs: number; outcome: string; errorCode: string | null; createdAt: string; userId: string | null };
type Breaker = { id: string; userId: string; reason: string | null; consecutiveFailures: number; frozenUntil: string | null; updatedAt: string };

export default function AdminTracesPage() {
    const [data, setData] = useState<{ totals: { runs: number; errors: number; cost: number; users: number }; capabilities: CapRow[]; recent: Event[]; breakers: Breaker[] } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useDeclareFocus(
        { scope: "admin.traces", label: "Agent traces", data: { capabilities: data?.capabilities.length ?? 0, runs24h: data?.totals.runs ?? 0, errors24h: data?.totals.errors ?? 0 } },
        [data?.totals.runs, data?.totals.errors, data?.capabilities.length],
    );

    const refresh = async () => {
        try {
            setError(null);
            const r = await fetch("/api/admin/traces", { cache: "no-store" });
            if (!r.ok) throw new Error(r.status === 403 ? "Admin access required" : `HTTP ${r.status}`);
            setData(await r.json());
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    };
    useEffect(() => { refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, []);

    const errPct = (data?.totals.runs ?? 0) > 0 ? (((data?.totals.errors ?? 0) / (data?.totals.runs ?? 1)) * 100).toFixed(1) : "0.0";

    return (
        <div className="dreyv-marketing-root relative h-dvh w-full overflow-y-auto font-manrope bg-white text-slate-900">
            <div className="fixed inset-0 pointer-events-none z-0" aria-hidden>
                <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
                <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
            </div>

            <header className="relative z-20 sticky top-0 backdrop-blur-md bg-white/75 border-b border-violet-100">
                <div className="mx-auto max-w-[1600px] px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-2xl bg-violet-100 border border-violet-200 flex items-center justify-center text-violet-700"><Activity size={18} /></div>
                        <div>
                            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700">dreyv · Traces</span>
                            <h1 className="mt-1 text-xl font-semibold tracking-tight">Agent observability</h1>
                            <p className="text-xs text-slate-500 mt-0.5">Last 24 hours · agent_tool_metrics</p>
                        </div>
                    </div>
                    <button onClick={() => { setLoading(true); refresh(); }} className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 hover:border-violet-400 hover:text-violet-700">
                        <RefreshCw size={13} className={`text-violet-600 ${loading ? "animate-spin" : ""}`} /> Refresh
                    </button>
                </div>
            </header>

            <main className="relative z-10 mx-auto max-w-[1600px] px-6 py-8 space-y-6">
                {error && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-700 flex items-center gap-2">
                        <AlertTriangle size={16} /> {error}
                    </div>
                )}

                <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Stat label="Tool runs · 24h" value={String(data?.totals.runs ?? 0)} />
                    <Stat label="Errors · 24h" value={String(data?.totals.errors ?? 0)} sub={`${errPct}% error rate`} accent={Number(errPct) > 5} />
                    <Stat label="Distinct users · 24h" value={String(data?.totals.users ?? 0)} />
                    <Stat label="LLM cost (est.) · 24h" value={`$${(data?.totals.cost ?? 0).toFixed(2)}`} />
                </section>

                <section className="rounded-3xl border border-violet-100 bg-white p-6">
                    <h2 className="text-sm font-semibold tracking-[0.14em] uppercase text-slate-500 mb-4 flex items-center gap-2"><Server size={14} className="text-violet-600" /> Per-capability performance</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-500 border-b border-violet-100">
                                <tr>
                                    <th className="text-left py-2 font-semibold">Capability</th>
                                    <th className="text-right font-semibold">Runs</th>
                                    <th className="text-right font-semibold">Errors</th>
                                    <th className="text-right font-semibold">Denied</th>
                                    <th className="text-right font-semibold">Avg ms</th>
                                    <th className="text-right font-semibold">p95 ms</th>
                                    <th className="text-right font-semibold">Cost USD</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data?.capabilities ?? []).map((c) => {
                                    const errRate = c.runs > 0 ? (c.errors / c.runs) * 100 : 0;
                                    return (
                                        <tr key={c.capabilityId} className="border-b border-violet-50 hover:bg-violet-50/30">
                                            <td className="py-2 font-mono text-[12px] text-slate-700">{c.capabilityId}</td>
                                            <td className="text-right tabular-nums">{c.runs}</td>
                                            <td className={`text-right tabular-nums ${errRate > 10 ? "text-rose-600 font-semibold" : ""}`}>{c.errors}</td>
                                            <td className="text-right tabular-nums text-slate-500">{c.denied}</td>
                                            <td className="text-right tabular-nums">{c.avgMs}</td>
                                            <td className="text-right tabular-nums">{c.p95Ms}</td>
                                            <td className="text-right tabular-nums">${c.costUsd.toFixed(3)}</td>
                                        </tr>
                                    );
                                })}
                                {!data?.capabilities.length && !loading && (
                                    <tr><td colSpan={7} className="py-8 text-center text-slate-400 text-xs">No tool runs in the last 24h.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="rounded-3xl border border-violet-100 bg-white p-6">
                        <h2 className="text-sm font-semibold tracking-[0.14em] uppercase text-slate-500 mb-4 flex items-center gap-2"><Shield size={14} className="text-violet-600" /> Circuit breakers</h2>
                        {(data?.breakers ?? []).length === 0 && <p className="text-xs text-slate-400">No breakers tripped.</p>}
                        <ul className="space-y-2">
                            {(data?.breakers ?? []).map((b) => {
                                const frozen = b.frozenUntil && new Date(b.frozenUntil) > new Date();
                                return (
                                    <li key={b.id} className="flex items-center justify-between p-3 rounded-2xl border border-violet-100 bg-violet-50/30 text-xs">
                                        <div>
                                            <div className="font-mono text-[11px] text-slate-700">{b.userId.slice(0, 8)}…</div>
                                            <div className="text-slate-500">{b.reason || "—"} · {b.consecutiveFailures} consecutive</div>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em] ${frozen ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{frozen ? "Frozen" : "Idle"}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className="rounded-3xl border border-violet-100 bg-white p-6">
                        <h2 className="text-sm font-semibold tracking-[0.14em] uppercase text-slate-500 mb-4">Recent events</h2>
                        <ul className="space-y-1.5 max-h-[420px] overflow-auto">
                            {(data?.recent ?? []).map((e) => (
                                <li key={e.id} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                                    <span className="text-slate-400 shrink-0">{new Date(e.createdAt).toLocaleTimeString()}</span>
                                    <span className="truncate flex-1 text-slate-700">{e.capabilityId}</span>
                                    <span className="tabular-nums text-slate-500">{e.latencyMs}ms</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider ${e.outcome === "ok" ? "bg-emerald-100 text-emerald-700" : e.outcome === "error" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{e.outcome}</span>
                                </li>
                            ))}
                            {!data?.recent.length && !loading && <li className="text-xs text-slate-400">No events yet.</li>}
                        </ul>
                    </div>
                </section>
            </main>
        </div>
    );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
    return (
        <div className={`rounded-3xl border bg-white p-5 ${accent ? "border-rose-200" : "border-violet-100"}`}>
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-slate-500">{label}</div>
            <div className={`mt-2 text-2xl font-semibold tracking-tight ${accent ? "text-rose-600" : "text-slate-900"}`}>{value}</div>
            {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
        </div>
    );
}
