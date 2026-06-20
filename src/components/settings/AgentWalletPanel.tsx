"use client";

/**
 * Hosted Agent Wallet panel — shows the user's custodial Solana wallet
 * used by POST /api/x402/pay (end-to-end autonomous agent payments).
 *
 * Displays funding address + USDC/SOL balance + Solana Pay QR for
 * one-tap top-up. The wallet is provisioned lazily on first GET.
 */

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Loader2, RefreshCcw, Wallet, AlertTriangle } from "lucide-react";
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
    receiving_wallet: string;
    rpc_error: string | null;
}

export function AgentWalletPanel() {
    const [data, setData] = useState<WalletData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

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
        ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(solanaPayUrl)}`
        : null;

    const usdcBalance = data?.usdc.balance ?? "—";
    const solBalance = data?.sol.balance != null ? data.sol.balance.toFixed(4) : "—";
    const lowSol = data?.sol.balance != null && data.sol.balance < 0.001;
    const zeroUsdc = data?.usdc.balance === "0" || data?.usdc.balance == null;

    return (
        <section className="rounded-3xl border border-violet-100 bg-white p-6 md:p-8">
            <header className="flex flex-wrap items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-600 text-white">
                    <Wallet className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <DreyvStar className="h-3.5 w-3.5 text-violet-600" />
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">Hosted agent wallet</p>
                    </div>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">Pay end-to-end without a human</h3>
                    <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
                        Fund this Solana wallet with USDC and your agents can call{" "}
                        <code className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[12px] text-violet-700">POST /api/x402/pay</code>{" "}
                        to settle invoices in one round-trip — no checkout URL, no human in the loop.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => load(true)}
                    disabled={loading || refreshing}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
                >
                    <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    Refresh
                </button>
            </header>

            {loading ? (
                <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading wallet…
                </div>
            ) : error ? (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    <p className="font-medium">Couldn&apos;t load the agent wallet.</p>
                    <p className="mt-1 text-xs">{error}</p>
                </div>
            ) : data ? (
                <div className="mt-6 grid gap-6 md:grid-cols-[1fr_180px]">
                    <div className="min-w-0 space-y-4">
                        {/* Address */}
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Wallet address</p>
                            <div className="mt-1.5 flex items-center gap-2">
                                <code className="min-w-0 flex-1 truncate rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2 font-mono text-[12px] text-slate-800">
                                    {data.address}
                                </code>
                                <button
                                    type="button"
                                    onClick={copy}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-700 transition hover:bg-violet-50"
                                >
                                    {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                    {copied ? "Copied" : "Copy"}
                                </button>
                                <a
                                    href={`https://solscan.io/account/${data.address}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-700 transition hover:bg-violet-50"
                                >
                                    Solscan <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        </div>

                        {/* Balances */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl border border-violet-100 bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">USDC balance</p>
                                <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">{usdcBalance}</p>
                                <p className="mt-0.5 text-[11px] text-slate-500">SPL · mainnet</p>
                            </div>
                            <div className="rounded-2xl border border-violet-100 bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">SOL balance</p>
                                <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">{solBalance}</p>
                                <p className="mt-0.5 text-[11px] text-slate-500">covers tx fees</p>
                            </div>
                        </div>

                        {/* Funding instructions */}
                        <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
                            <p className="text-sm font-medium text-slate-900">How to fund</p>
                            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[13px] leading-relaxed text-slate-700">
                                <li>Send <strong>USDC</strong> (SPL, Solana mainnet) to the address above. Scan the QR with any Solana wallet.</li>
                                <li>Send a small <strong>SOL float</strong> (~0.01 SOL is plenty) for transaction fees.</li>
                                <li>Click <em>Refresh</em>. Your agent can immediately call <code className="font-mono text-[11px]">POST /api/x402/pay</code>.</li>
                            </ol>
                            {(zeroUsdc || lowSol) && (
                                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span>
                                        {zeroUsdc ? "No USDC yet — autonomous payments will return 402 with funding instructions. " : ""}
                                        {lowSol ? "Low SOL — top up at least 0.001 SOL or transactions can&apos;t be broadcast." : ""}
                                    </span>
                                </div>
                            )}
                        </div>

                        <p className="text-[11px] leading-relaxed text-slate-500">
                            <strong>Custodial.</strong> The private key is encrypted at rest and only ever used to pay Dreyv invoices.
                            Don&apos;t use this wallet as a treasury — keep just enough balance for upcoming agent calls.
                        </p>
                    </div>

                    {/* QR */}
                    <div className="hidden flex-col items-center gap-2 md:flex">
                        {qrUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qrUrl} alt="Solana Pay top-up" width={180} height={180} className="rounded-2xl border border-violet-100 bg-white p-2" />
                        ) : null}
                        <p className="text-[11px] text-slate-500">Scan to top up USDC</p>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
