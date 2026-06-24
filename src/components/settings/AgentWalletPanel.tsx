"use client";

/**
 * Hosted Agent Wallet panel — slim, Apple-style.
 *
 * Shows the user's custodial Solana wallet used by POST /api/x402/pay.
 * Address + balances live on one row each; QR and "how to fund" collapse
 * behind disclosure affordances so the panel stays quiet until needed.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
    CheckCircle2,
    ChevronDown,
    Copy,
    ExternalLink,
    Loader2,
    QrCode,
    RefreshCcw,
    AlertTriangle,
} from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface WalletData {
    address: string;
    created_at: string;
    usdc: {
        mint: string;
        decimals: number;
        balance_minor: string | null;
        balance: string | null;
        account_exists: boolean | null;
    };
    sol: {
        balance_lamports: string | null;
        balance: number | null;
    };
    prepaid: {
        balance_minor: string;
        balance: string;
        currency: string;
        updated_at: string;
    } | null;
    receiving_wallet: string;
    rpc_error: string | null;
}

function formatUsd(value: string | null | undefined): string {
    if (!value) return "$0.00";
    const n = Number(value);
    if (!Number.isFinite(n)) return "$0.00";
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortenAddress(addr: string) {
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

export function AgentWalletPanel() {
    const [data, setData] = useState<WalletData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const [showHelp, setShowHelp] = useState(false);

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true); else setRefreshing(true);
        setError(null);
        try {
            const res = await fetch("/api/agent/wallet", { cache: "no-store" });
            if (!res.ok) {
                const body = await res.json().catch(() => ({} as { error?: string; message?: string }));
                setError(body.message || body.error || `HTTP ${res.status}`);
                return;
            }
            const json = (await res.json()) as WalletData;
            setData(json);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load wallet");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const copy = async () => {
        if (!data?.address) return;
        try {
            await navigator.clipboard.writeText(data.address);
            setCopied(true);
            toast.success("Address copied");
            setTimeout(() => setCopied(false), 1800);
        } catch {
            toast.error("Copy failed");
        }
    };

    const solanaPayUrl = data
        ? `solana:${data.address}?spl-token=${data.usdc.mint}&label=Dreyv%20Agent%20Wallet&message=Top-up%20for%20agent%20payments`
        : null;
    const qrUrl = solanaPayUrl
        ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(solanaPayUrl)}`
        : null;

    const usdcBalance = data?.usdc.balance ?? "—";
    const solBalance = data?.sol.balance != null ? data.sol.balance.toFixed(4) : "—";
    const lowSol = data?.sol.balance != null && data.sol.balance < 0.001;
    const zeroUsdc = data?.usdc.balance === "0" || data?.usdc.balance == null;
    const hasWarning = !!data && (zeroUsdc || lowSol);

    return (
        <section className="rounded-3xl border border-violet-100 bg-white p-5 md:p-6">
            {/* Header — slim, no oversized avatar */}
            <header className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <DreyvStar className="h-3 w-3 text-violet-600" />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-700">
                            Hosted agent wallet
                        </p>
                    </div>
                    <h3 className="mt-1 text-[15px] font-semibold text-slate-900">
                        Pay end-to-end without a human
                    </h3>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
                        Fund with USDC so agents can settle invoices via{" "}
                        <code className="rounded bg-violet-50 px-1 py-0.5 font-mono text-[11px] text-violet-700">
                            POST /api/x402/pay
                        </code>
                        .
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => load(true)}
                    disabled={loading || refreshing}
                    aria-label="Refresh wallet"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
                >
                    <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                </button>
            </header>

            {loading ? (
                <div className="mt-5 flex items-center gap-2 text-[12px] text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading wallet…
                </div>
            ) : error ? (
                <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">
                    <p className="font-medium">Couldn&apos;t load the agent wallet.</p>
                    <p className="mt-0.5 text-[11px]">{error}</p>
                </div>
            ) : data ? (
                <div className="mt-5 space-y-2">
                    {/* Address row — single line, monospace, hover-revealed actions */}
                    <div className="group flex h-10 items-center gap-2 rounded-xl border border-violet-100 bg-white px-3 hover:bg-violet-50/40">
                        <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                            aria-hidden
                            title="Wallet ready"
                        />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Addr
                        </span>
                        <code
                            className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-800"
                            title={data.address}
                        >
                            <span className="hidden md:inline">{data.address}</span>
                            <span className="md:hidden">{shortenAddress(data.address)}</span>
                        </code>
                        <button
                            type="button"
                            onClick={copy}
                            aria-label="Copy address"
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-violet-100 hover:text-violet-700"
                        >
                            {copied ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </button>
                        <a
                            href={`https://solscan.io/account/${data.address}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="View on Solscan"
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-violet-100 hover:text-violet-700"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <button
                            type="button"
                            onClick={() => setShowQr((v) => !v)}
                            aria-label={showQr ? "Hide top-up QR" : "Show top-up QR"}
                            aria-expanded={showQr}
                            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${
                                showQr
                                    ? "bg-violet-100 text-violet-700"
                                    : "text-slate-400 hover:bg-violet-100 hover:text-violet-700"
                            }`}
                        >
                            <QrCode className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {/* Balances — two thin rows, inline labels and units */}
                    <div className="grid gap-2 sm:grid-cols-2">
                        <BalanceRow
                            label="USDC"
                            value={usdcBalance}
                            unit="SPL · mainnet"
                            warn={zeroUsdc}
                        />
                        <BalanceRow
                            label="SOL"
                            value={solBalance}
                            unit="tx fees"
                            warn={lowSol}
                        />
                    </div>

                    {/* QR — collapsed by default, inline reveal */}
                    {showQr && qrUrl && (
                        <div className="flex items-center gap-4 rounded-xl border border-violet-100 bg-violet-50/30 p-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={qrUrl}
                                alt="Solana Pay top-up QR"
                                width={132}
                                height={132}
                                className="rounded-lg border border-violet-100 bg-white p-1.5"
                            />
                            <div className="min-w-0 text-[12px] leading-relaxed text-slate-600">
                                <p className="font-medium text-slate-900">Scan to top up USDC</p>
                                <p className="mt-0.5 text-[11px] text-slate-500">
                                    Solana Pay — opens directly in Phantom, Solflare, Backpack, and
                                    other Solana wallets.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Warning — inline, only when relevant */}
                    {hasWarning && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>
                                {zeroUsdc &&
                                    "No USDC yet — autonomous payments will return 402 until funded. "}
                                {lowSol &&
                                    "Low SOL — top up at least 0.001 SOL or transactions can\u2019t be broadcast."}
                            </span>
                        </div>
                    )}

                    {/* Disclosure — how to fund + custodial note */}
                    <button
                        type="button"
                        onClick={() => setShowHelp((v) => !v)}
                        aria-expanded={showHelp}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:underline"
                    >
                        <ChevronDown
                            className={`h-3 w-3 transition-transform ${showHelp ? "rotate-180" : ""}`}
                        />
                        {showHelp ? "Hide" : "How to fund & safety"}
                    </button>
                    {showHelp && (
                        <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-3 text-[12px] leading-relaxed text-slate-700">
                            <ol className="list-decimal space-y-1 pl-4">
                                <li>
                                    Send <strong>USDC</strong> (SPL, Solana mainnet) to the address
                                    above — scan the QR with any Solana wallet.
                                </li>
                                <li>
                                    Send a small <strong>SOL float</strong> (~0.01 SOL is plenty) for
                                    transaction fees.
                                </li>
                                <li>
                                    Refresh. Your agent can immediately call{" "}
                                    <code className="font-mono text-[11px]">POST /api/x402/pay</code>.
                                </li>
                            </ol>
                            <p className="mt-2 text-[11px] text-slate-500">
                                <strong className="text-slate-700">Custodial.</strong> Private key is
                                encrypted at rest and only used to pay Dreyv invoices. Don&apos;t use
                                this as a treasury — keep just enough for upcoming agent calls.
                            </p>
                        </div>
                    )}
                </div>
            ) : null}
        </section>
    );
}

function BalanceRow({
    label,
    value,
    unit,
    warn,
}: {
    label: string;
    value: string;
    unit: string;
    warn?: boolean;
}) {
    return (
        <div className="flex h-10 items-center gap-2 rounded-xl border border-violet-100 bg-white px-3">
            <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${warn ? "bg-amber-500" : "bg-emerald-500"}`}
                aria-hidden
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {label}
            </span>
            <span className="ml-auto font-mono text-[14px] font-semibold tabular-nums text-slate-900">
                {value}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-slate-400">{unit}</span>
        </div>
    );
}
