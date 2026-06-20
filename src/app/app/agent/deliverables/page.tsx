"use client";

/**
 * /app/agent/deliverables
 *
 * The post-payment delivery dashboard: every paid agent output the user
 * has accumulated. Filter by kind, jump into the permalink view, or
 * re-fire the email.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Mail, RefreshCw, Wallet, Crown, FileText, Camera } from "lucide-react";
import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface Row {
    id: string;
    kind: "snapshot" | "report" | "subscription";
    sku: string;
    targetWallet: string | null;
    status: "generating" | "ready" | "failed";
    summary: Record<string, unknown>;
    pdfUrl: string | null;
    emailTo: string | null;
    emailSentAt: string | null;
    emailError: string | null;
    error: string | null;
    createdAt: string;
    readyAt: string | null;
    agentKeyLabel: string | null;
    amountUsd: string | null;
    txSignature: string | null;
}

const KIND_TABS = [
    { id: null, label: "All" },
    { id: "snapshot", label: "Snapshots" },
    { id: "report", label: "Reports" },
    { id: "subscription", label: "Subscriptions" },
] as const;

function truncateMiddle(s: string | null | undefined, head = 6, tail = 6): string {
    if (!s) return "—";
    if (s.length <= head + tail + 3) return s;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function fmtRel(iso: string | null): string {
    if (!iso) return "—";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
    return `${Math.floor(ms / (24 * 60 * 60_000))}d ago`;
}

function fmtUsd(n: number): string {
    if (!Number.isFinite(n)) return "$0.00";
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function KindChip({ kind }: { kind: Row["kind"] }) {
    const map = {
        snapshot: { label: "Snapshot", Icon: Camera },
        report: { label: "AI Report", Icon: FileText },
        subscription: { label: "Subscription", Icon: Crown },
    } as const;
    const { label, Icon } = map[kind];
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
            <Icon className="h-3 w-3" />
            {label}
        </span>
    );
}

function StatusChip({ status }: { status: Row["status"] }) {
    if (status === "ready")
        return <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Ready</span>;
    if (status === "generating")
        return <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Generating…</span>;
    return <span className="rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-semibold text-rose-700">Failed</span>;
}

export default function DeliverablesPage() {
    const [rows, setRows] = useState<Row[] | null>(null);
    const [kind, setKind] = useState<string | null>(null);
    const [resending, setResending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        try {
            setError(null);
            const url = kind ? `/api/agent/deliverables?kind=${kind}` : "/api/agent/deliverables";
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) {
                if (res.status === 401) {
                    setError("Sign in to view your agent deliverables.");
                    setRows([]);
                    return;
                }
                throw new Error(`${res.status}`);
            }
            const json = await res.json();
            setRows(json.deliverables ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "load_failed");
            setRows([]);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind]);

    async function resend(id: string) {
        setResending(id);
        try {
            const res = await fetch(`/api/agent/deliverables/${id}/resend`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                alert(body?.message || body?.error || `Resend failed (${res.status})`);
            } else {
                await load();
            }
        } finally {
            setResending(null);
        }
    }

    const counts = useMemo(() => {
        const c = { all: 0, snapshot: 0, report: 0, subscription: 0 };
        (rows ?? []).forEach((r) => {
            c.all += 1;
            c[r.kind] += 1;
        });
        return c;
    }, [rows]);

    return (
        <main className="relative min-h-screen overflow-hidden bg-white text-zinc-900">
            <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-violet-400/20 blur-[140px]" />
            <div aria-hidden className="pointer-events-none absolute top-[40%] -right-32 h-[380px] w-[380px] rounded-full bg-violet-300/25 blur-[120px]" />

            <div className="relative mx-auto w-full max-w-6xl px-6 pt-12 pb-24 sm:pt-16">
                <header className="grid grid-cols-1 items-start gap-8 md:grid-cols-[1fr_auto]">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
                            <DreyvStar className="text-violet-600" size={12} />
                            Agent deliverables
                        </div>
                        <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-zinc-900 sm:text-5xl">
                            Everything your agents have paid for.
                        </h1>
                        <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-600">
                            Every snapshot, AI report and subscription your autonomous agents have purchased
                            with the hosted wallet — permalinked, downloadable, and emailed to you the second
                            the on-chain transfer settles.
                        </p>
                    </div>
                    <DreyvMascot pose="celebrate" size={132} className="hidden md:block" />
                </header>

                {/* Filter tabs */}
                <nav className="mt-10 flex flex-wrap gap-2">
                    {KIND_TABS.map((t) => {
                        const active = (kind ?? null) === (t.id ?? null);
                        const count = t.id ? counts[t.id as keyof typeof counts] : counts.all;
                        return (
                            <button
                                key={t.label}
                                onClick={() => setKind(t.id ?? null)}
                                className={
                                    "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition " +
                                    (active
                                        ? "border-violet-600 bg-violet-600 text-white"
                                        : "border-violet-200 bg-white text-zinc-700 hover:border-violet-300")
                                }
                            >
                                {t.label}
                                <span className={"rounded-full px-1.5 text-[11px] font-semibold " + (active ? "bg-white/20 text-white" : "bg-violet-50 text-violet-700")}>
                                    {rows == null ? "…" : count}
                                </span>
                            </button>
                        );
                    })}
                </nav>

                {/* Table */}
                <section className="mt-8 rounded-3xl border border-violet-100 bg-white overflow-hidden">
                    {rows == null && (
                        <div className="px-6 py-16 text-center text-sm text-zinc-500">Loading deliverables…</div>
                    )}
                    {rows != null && rows.length === 0 && (
                        <div className="px-6 py-16 text-center">
                            <DreyvMascot pose="think" size={96} className="mx-auto" />
                            <h3 className="mt-4 text-lg font-semibold text-zinc-900">No deliverables yet.</h3>
                            <p className="mt-2 max-w-md mx-auto text-sm text-zinc-600">
                                When an agent pays for a snapshot, an AI report, or a subscription with your hosted
                                wallet, it shows up here with a permalink and an email receipt — no more guessing
                                where the output went.
                            </p>
                            {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
                            <Link
                                href="/developers"
                                className="mt-6 inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
                            >
                                Developer docs
                                <ArrowUpRight className="h-4 w-4" />
                            </Link>
                        </div>
                    )}
                    {rows != null && rows.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[920px] text-left text-sm">
                                <thead className="border-b border-violet-100 bg-violet-50/50 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                                    <tr>
                                        <th className="px-5 py-3">When</th>
                                        <th className="px-5 py-3">Kind</th>
                                        <th className="px-5 py-3">Target wallet</th>
                                        <th className="px-5 py-3">Agent key</th>
                                        <th className="px-5 py-3 text-right">Amount</th>
                                        <th className="px-5 py-3">Status</th>
                                        <th className="px-5 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r) => (
                                        <tr key={r.id} className="border-b border-violet-100 last:border-b-0 hover:bg-violet-50/40 transition">
                                            <td className="px-5 py-4 text-zinc-700">
                                                <div>{fmtRel(r.createdAt)}</div>
                                                <div className="text-[11px] text-zinc-400 mt-0.5">
                                                    {new Date(r.createdAt).toLocaleString()}
                                                </div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <KindChip kind={r.kind} />
                                                <div className="text-[11px] text-zinc-500 mt-1.5 font-mono">{r.sku}</div>
                                            </td>
                                            <td className="px-5 py-4">
                                                {r.targetWallet ? (
                                                    <div className="inline-flex items-center gap-2">
                                                        <Wallet className="h-3.5 w-3.5 text-violet-500" />
                                                        <span className="font-mono text-zinc-800" title={r.targetWallet}>
                                                            {truncateMiddle(r.targetWallet, 8, 8)}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-zinc-400">—</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 text-zinc-700">
                                                {r.agentKeyLabel || <span className="text-xs text-zinc-400">deleted</span>}
                                            </td>
                                            <td className="px-5 py-4 text-right font-medium text-zinc-900">
                                                {r.amountUsd ? `$${Number(r.amountUsd).toFixed(2)}` : "—"}
                                            </td>
                                            <td className="px-5 py-4">
                                                <StatusChip status={r.status} />
                                                {r.emailSentAt && (
                                                    <div className="text-[11px] text-zinc-400 mt-1.5 inline-flex items-center gap-1">
                                                        <Mail className="h-3 w-3" />
                                                        emailed {fmtRel(r.emailSentAt)}
                                                    </div>
                                                )}
                                                {r.emailError && !r.emailSentAt && (
                                                    <div className="text-[11px] text-rose-500 mt-1.5">email failed</div>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 text-right">
                                                <div className="inline-flex items-center gap-2">
                                                    {r.status === "ready" && r.emailTo && (
                                                        <button
                                                            onClick={() => resend(r.id)}
                                                            disabled={resending === r.id}
                                                            className="inline-flex items-center gap-1 rounded-full border border-violet-200 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                                                            title="Re-send email"
                                                        >
                                                            <RefreshCw className={"h-3 w-3 " + (resending === r.id ? "animate-spin" : "")} />
                                                            Resend
                                                        </button>
                                                    )}
                                                    <Link
                                                        href={`/app/agent/deliverables/${r.id}`}
                                                        className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
                                                    >
                                                        Open
                                                        <ArrowUpRight className="h-3 w-3" />
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
