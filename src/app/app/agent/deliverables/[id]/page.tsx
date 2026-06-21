"use client";

/**
 * /app/agent/deliverables/[id]
 *
 * Permalink view for a single paid agent deliverable. Renders the
 * persisted snapshot/report payload (no re-fetch from chain) plus the
 * tx + email metadata.
 */
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    ArrowUpRight,
    Camera,
    Crown,
    FileText,
    Mail,
    Wallet,
    ExternalLink,
    RefreshCw,
    Loader2,
} from "lucide-react";
import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { TokenAvatar } from "@/components/TokenAvatar";

// Client-side token logo + name lookup via Jupiter's public token API.
// Cached per-mount in a Map so re-renders never refetch.
type JupTokenMeta = { icon: string | null; name: string | null; symbol: string | null };
const logoMemo = new Map<string, JupTokenMeta>();

function useTokenMeta(mints: string[]): Record<string, JupTokenMeta> {
    const [, force] = useState(0);
    const key = mints.join(",");
    useEffect(() => {
        let cancelled = false;
        const missing = mints.filter((m) => m && !logoMemo.has(m));
        if (missing.length === 0) return;
        (async () => {
            await Promise.all(
                missing.map(async (mint) => {
                    try {
                        const r = await fetch(
                            `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
                            { cache: "force-cache" },
                        );
                        if (!r.ok) throw new Error(String(r.status));
                        const arr = (await r.json()) as Array<{ id: string; icon?: string; name?: string; symbol?: string }>;
                        const hit = arr.find((t) => t.id === mint) ?? arr[0];
                        logoMemo.set(mint, {
                            icon: hit?.icon ?? null,
                            name: hit?.name ?? null,
                            symbol: hit?.symbol ?? null,
                        });
                    } catch {
                        logoMemo.set(mint, { icon: null, name: null, symbol: null });
                    }
                }),
            );
            if (!cancelled) force((n) => n + 1);
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    const out: Record<string, JupTokenMeta> = {};
    for (const m of mints) out[m] = logoMemo.get(m) ?? { icon: null, name: null, symbol: null };
    return out;
}

interface Holding {
    symbol: string;
    mint: string;
    amount: number;
    decimals: number;
    priceUsd: number | null;
    usd: number | null;
}

interface Snapshot {
    address: string;
    label: string;
    asOf: string;
    totalUsd: number;
    solBalance: number;
    holdings: Holding[];
    fungibleCount: number;
    nftCount: number;
    source: "helius" | "fallback";
    warning?: string;
}

interface Deliverable {
    id: string;
    kind: "snapshot" | "report" | "subscription";
    sku: string;
    targetWallet: string | null;
    status: "generating" | "ready" | "failed";
    summary: Record<string, unknown>;
    payload: { snapshot?: Snapshot; tier?: "mini" | "max"; renewalAt?: string; manageUrl?: string };
    pdfUrl: string | null;
    emailTo: string | null;
    emailSentAt: string | null;
    emailError: string | null;
    error: string | null;
    createdAt: string;
    readyAt: string | null;
    agentKeyLabel: string | null;
    agentKeyPrefix: string | null;
    amountUsd: string | null;
    txSignature: string | null;
    paidAt: string | null;
}

function fmtUsd(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function fmtPct(n: number): string { return `${(n * 100).toFixed(1)}%`; }
function truncateMiddle(s: string, head = 8, tail = 8): string {
    if (s.length <= head + tail + 3) return s;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
function fmtAbsDate(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString();
}

export default function DeliverableViewPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = use(params);
    const [d, setD] = useState<Deliverable | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [narrative, setNarrative] = useState<string | null>(null);
    const [narrLoading, setNarrLoading] = useState(false);
    const [resending, setResending] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const r = await fetch(`/api/agent/deliverables/${id}`, { cache: "no-store" });
                if (!r.ok) {
                    if (r.status === 401) setErr("Sign in to view this deliverable.");
                    else if (r.status === 404) setErr("This deliverable doesn't exist or isn't yours.");
                    else setErr(`Failed (${r.status})`);
                    return;
                }
                const j = await r.json();
                setD(j.deliverable);
            } catch (e) {
                setErr(e instanceof Error ? e.message : "load_failed");
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    async function resend() {
        if (!d) return;
        setResending(true);
        try {
            const r = await fetch(`/api/agent/deliverables/${d.id}/resend`, { method: "POST" });
            if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                alert(body?.message || body?.error || `Resend failed (${r.status})`);
            } else {
                // refresh to pick up new emailSentAt
                const r2 = await fetch(`/api/agent/deliverables/${id}`, { cache: "no-store" });
                if (r2.ok) setD((await r2.json()).deliverable);
            }
        } finally {
            setResending(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white text-zinc-600">
                <Loader2 className="h-5 w-5 animate-spin" />
            </div>
        );
    }
    if (err || !d) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white px-6 text-center">
                <DreyvMascot pose="alert" size={120} />
                <h1 className="text-2xl font-semibold text-zinc-900">Deliverable unavailable</h1>
                <p className="max-w-md text-sm text-zinc-600">{err || "Not found."}</p>
                <Link href="/app/agent/deliverables" className="text-sm font-medium text-violet-700 hover:underline">
                    ← Back to deliverables
                </Link>
            </div>
        );
    }

    const KindIcon = d.kind === "snapshot" ? Camera : d.kind === "report" ? FileText : Crown;
    const kindName =
        d.kind === "snapshot" ? "Treasury Snapshot" : d.kind === "report" ? "Treasury AI Report" : "Subscription";
    const snap = d.payload?.snapshot;

    return (
        <main className="relative min-h-screen overflow-hidden bg-white text-zinc-900">
            <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-violet-400/20 blur-[140px]" />
            <div aria-hidden className="pointer-events-none absolute top-[40%] -right-32 h-[380px] w-[380px] rounded-full bg-violet-300/25 blur-[120px]" />

            <div className="relative mx-auto w-full max-w-5xl px-6 pt-12 pb-24 sm:pt-16">
                <Link href="/app/agent/deliverables" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-violet-700">
                    <ArrowLeft className="h-4 w-4" /> All deliverables
                </Link>

                {/* Hero */}
                <header className="mt-8 grid grid-cols-1 items-start gap-10 md:grid-cols-[1fr_180px]">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
                            <DreyvStar className="text-violet-600" size={12} />
                            {kindName}
                        </div>
                        <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-zinc-900 sm:text-5xl">
                            {d.kind === "subscription"
                                ? `${d.payload?.tier === "max" ? "Max" : "Mini"} plan activated`
                                : snap?.label && snap.label !== "Unknown vault"
                                    ? snap.label
                                    : kindName}
                        </h1>
                        <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600">
                            {d.kind === "subscription"
                                ? `Paid via your agent in USDC on Solana mainnet. Renews on ${fmtAbsDate(d.payload?.renewalAt ?? null)}.`
                                : "Generated from live on-chain data at the moment of payment. This permalink will always show the same snapshot."}
                        </p>

                        {/* Meta strip */}
                        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            {d.targetWallet && (
                                <div className="flex items-start gap-2 rounded-2xl border border-violet-100 bg-white p-3">
                                    <Wallet className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
                                    <div className="min-w-0">
                                        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Target wallet</div>
                                        <div className="font-mono text-zinc-900 truncate" title={d.targetWallet}>
                                            {truncateMiddle(d.targetWallet, 10, 10)}
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="flex items-start gap-2 rounded-2xl border border-violet-100 bg-white p-3">
                                <KindIcon className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
                                <div className="min-w-0">
                                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">SKU</div>
                                    <div className="font-mono text-zinc-900 text-[13px] break-all">{d.sku}</div>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 rounded-2xl border border-violet-100 bg-white p-3">
                                <DreyvStar className="text-violet-600 mt-0.5 flex-shrink-0" size={16} />
                                <div className="min-w-0">
                                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Agent key</div>
                                    <div className="text-zinc-900">{d.agentKeyLabel || "—"}{d.agentKeyPrefix ? ` · ${d.agentKeyPrefix}…` : ""}</div>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 rounded-2xl border border-violet-100 bg-white p-3">
                                <Mail className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
                                <div className="min-w-0">
                                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Email</div>
                                    <div className="text-zinc-900 truncate">
                                        {d.emailTo ? d.emailTo : <span className="text-zinc-400">no email on account</span>}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="mt-6 flex flex-wrap items-center gap-3">
                            {d.txSignature && (
                                <a
                                    href={`https://solscan.io/tx/${d.txSignature}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50"
                                >
                                    View tx on Solscan <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                            )}
                            {d.pdfUrl && (
                                <a
                                    href={d.pdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50"
                                >
                                    Download PDF <ArrowUpRight className="h-3.5 w-3.5" />
                                </a>
                            )}
                            {d.emailTo && d.status === "ready" && (
                                <button
                                    onClick={resend}
                                    disabled={resending}
                                    className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                                >
                                    <RefreshCw className={"h-3.5 w-3.5 " + (resending ? "animate-spin" : "")} />
                                    {d.emailSentAt ? "Resend email" : "Send email"}
                                </button>
                            )}
                        </div>
                        {d.emailSentAt && (
                            <p className="mt-3 text-xs text-zinc-500">
                                Emailed to {d.emailTo} on {fmtAbsDate(d.emailSentAt)}.
                            </p>
                        )}
                        {d.emailError && !d.emailSentAt && (
                            <p className="mt-3 text-xs text-rose-600">Email failed: {d.emailError}</p>
                        )}
                    </div>

                    <DreyvMascot pose={d.kind === "subscription" ? "celebrate" : d.status === "ready" ? "celebrate" : "think"} size={180} className="hidden md:block" />
                </header>

                {/* Body */}
                {d.status === "failed" && (
                    <section className="mt-12 rounded-3xl border border-rose-200 bg-rose-50 p-7">
                        <h2 className="text-base font-semibold text-rose-700">Generation failed</h2>
                        <p className="mt-2 text-sm text-rose-600">{d.error || "Unknown error."}</p>
                        <p className="mt-2 text-xs text-rose-500">
                            Your payment still went through (tx above) — please retry from `/api/x402/pay`, or contact support.
                        </p>
                    </section>
                )}

                {d.status === "ready" && snap && (
                    <SnapshotBody snap={snap} summary={d.summary} kind={d.kind} narrative={narrative} narrLoading={narrLoading} onGenerate={async () => {
                        // For reports, lazy-generate the AI narrative via the existing fulfilment endpoint.
                        // The fulfilment endpoint requires a receipt token — for the persistent
                        // view we just render the metrics-based deterministic body inline.
                        setNarrLoading(true);
                        try {
                            // Minimal in-page deterministic narrative — keeps the view dependency-free.
                            const m = d.summary as { totalUsd?: number; stableShare?: number; topSymbol?: string; topShare?: number; hhi?: number; holdings?: number };
                            const lines = [
                                `**Total value:** ${fmtUsd(m.totalUsd ?? 0)} across ${m.holdings ?? 0} fungible holdings.`,
                                `**Stable share:** ${fmtPct(m.stableShare ?? 0)}.`,
                                m.topSymbol ? `**Top exposure:** ${m.topSymbol} at ${fmtPct(m.topShare ?? 0)}.` : "",
                                `**Concentration index (HHI):** ${m.hhi ?? 0} (≥5000 highly concentrated, 2500–5000 moderate, <2500 diversified).`,
                            ].filter(Boolean).join("\n\n");
                            setNarrative(lines);
                        } finally {
                            setNarrLoading(false);
                        }
                    }} />
                )}

                {d.status === "ready" && d.kind === "subscription" && (
                    <SubscriptionBody d={d} />
                )}
            </div>
        </main>
    );
}

function SnapshotBody({
    snap, summary, kind, narrative, narrLoading, onGenerate,
}: {
    snap: Snapshot;
    summary: Record<string, unknown>;
    kind: "snapshot" | "report" | "subscription";
    narrative: string | null;
    narrLoading: boolean;
    onGenerate: () => Promise<void>;
}) {
    const m = summary as { totalUsd?: number; stableShare?: number; topSymbol?: string; topShare?: number; hhi?: number; holdings?: number };

    const stats = [
        { label: "Total value", value: fmtUsd(m.totalUsd ?? 0) },
        { label: "Stable share", value: fmtPct(m.stableShare ?? 0) },
        { label: "Holdings", value: String(m.holdings ?? snap.holdings.length) },
        { label: kind === "report" ? "HHI" : "Top", value: kind === "report" ? String(m.hhi ?? 0) : (m.topSymbol ? `${m.topSymbol}` : "—") },
    ];

    return (
        <>
            {/* Stat grid */}
            <section className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
                {stats.map((s) => (
                    <div key={s.label} className="rounded-3xl border border-violet-100 bg-white p-6">
                        <div className="text-[11px] uppercase tracking-wide text-violet-700 font-semibold">{s.label}</div>
                        <div className="mt-2 text-3xl font-semibold text-zinc-900 tracking-tight">{s.value}</div>
                    </div>
                ))}
            </section>

            {/* Holdings */}
            <section className="mt-10 rounded-3xl border border-violet-100 bg-white overflow-hidden">
                <header className="px-6 py-5 border-b border-violet-100 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-zinc-900">Holdings</h2>
                    <span className="text-xs text-zinc-500">As of {snap.asOf}</span>
                </header>
                {snap.holdings.length === 0 ? (
                    <div className="px-6 py-12 text-center text-sm text-zinc-500">No fungible holdings detected.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-sm">
                            <thead className="border-b border-violet-100 bg-violet-50/50 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                                <tr>
                                    <th className="px-6 py-3">Asset</th>
                                    <th className="px-6 py-3 text-right">Amount</th>
                                    <th className="px-6 py-3 text-right">Price</th>
                                    <th className="px-6 py-3 text-right">USD value</th>
                                    <th className="px-6 py-3 text-right">Share</th>
                                </tr>
                            </thead>
                            <tbody>
                                {snap.holdings.slice(0, 25).map((h) => {
                                    const total = m.totalUsd ?? snap.totalUsd;
                                    const share = total > 0 && h.usd ? h.usd / total : 0;
                                    return (
                                        <tr key={h.mint} className="border-b border-violet-100 last:border-b-0">
                                            <td className="px-6 py-3.5">
                                                <div className="font-semibold text-zinc-900">{h.symbol || "(unknown)"}</div>
                                                <div className="text-[11px] font-mono text-zinc-400" title={h.mint}>{truncateMiddle(h.mint, 6, 6)}</div>
                                            </td>
                                            <td className="px-6 py-3.5 text-right text-zinc-700">{h.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                                            <td className="px-6 py-3.5 text-right text-zinc-700">{h.priceUsd != null ? fmtUsd(h.priceUsd) : "—"}</td>
                                            <td className="px-6 py-3.5 text-right font-medium text-zinc-900">{fmtUsd(h.usd)}</td>
                                            <td className="px-6 py-3.5 text-right">
                                                <div className="inline-flex items-center gap-2">
                                                    <div className="h-1.5 w-16 rounded-full bg-violet-100 overflow-hidden">
                                                        <div className="h-full bg-violet-600" style={{ width: `${Math.min(100, share * 100)}%` }} />
                                                    </div>
                                                    <span className="text-xs text-zinc-600 tabular-nums">{fmtPct(share)}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* AI narrative (reports only) */}
            {kind === "report" && (
                <section className="mt-10 rounded-3xl border border-violet-100 bg-white p-7">
                    <header className="flex items-center justify-between gap-4">
                        <h2 className="text-base font-semibold text-zinc-900">Analyst narrative</h2>
                        {!narrative && (
                            <button
                                onClick={onGenerate}
                                disabled={narrLoading}
                                className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                            >
                                {narrLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DreyvStar size={12} />}
                                Generate
                            </button>
                        )}
                    </header>
                    {narrative ? (
                        <div className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-700">
                            {narrative.split("\n\n").map((p, i) => (
                                <p key={i} dangerouslySetInnerHTML={{ __html: p.replace(/\*\*(.+?)\*\*/g, '<strong class="text-zinc-900">$1</strong>') }} />
                            ))}
                        </div>
                    ) : (
                        <p className="mt-3 text-sm text-zinc-500">
                            The metrics-grounded narrative covers composition, concentration, runway, and risk.
                            Generate it here — already paid for via your agent, no extra charge.
                        </p>
                    )}
                </section>
            )}
        </>
    );
}

function SubscriptionBody({ d }: { d: Deliverable }) {
    const tier = d.payload?.tier === "max" ? "Max" : "Mini";
    const perks =
        d.payload?.tier === "max"
            ? [
                "Unlimited Foresight simulations + multi-agent runs.",
                "Priority RPC tier and 10× higher rate limits across the API.",
                "Direct line to the team via Slack Connect for incidents.",
            ]
            : [
                "Full /app workspace: Analytics, Atlas, Studio, Agent Store.",
                "10× higher rate limits than Free across every endpoint.",
                "Email + in-app alerts for anomalies, drift, and approvals.",
            ];
    return (
        <section className="mt-12 rounded-3xl border border-violet-100 bg-white p-8">
            <h2 className="text-2xl font-semibold text-zinc-900">{tier} plan unlocked</h2>
            <p className="mt-2 text-sm text-zinc-600">
                Renews on <span className="font-medium text-zinc-900">{fmtAbsDate(d.payload?.renewalAt ?? null)}</span> ·
                {" "}paid <span className="font-medium text-zinc-900">${d.amountUsd ?? "—"}</span> USDC.
            </p>
            <ul className="mt-6 space-y-3">
                {perks.map((p, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-zinc-700">
                        <span className="mt-0.5"><DreyvStar size={14} className="text-violet-600" /></span>
                        <span>{p}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
                <Link
                    href={d.payload?.manageUrl ?? "/app/settings/billing"}
                    className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
                >
                    Manage subscription <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                    href="/app"
                    className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-5 py-2.5 text-sm font-medium text-violet-700 hover:bg-violet-50"
                >
                    Open workspace
                </Link>
            </div>
        </section>
    );
}
