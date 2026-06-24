"use client";

/**
 * Hosted Agent Wallet — Apple-grade redesign.
 *
 * Two funding rails on one canvas:
 *   1. Dreyv Prepaid Balance — USDC credits charged per capability call.
 *      Top up via Stripe (cards) or Paystack (Africa-first, mobile money).
 *   2. Dreyv Hosted Wallet — on-chain Solana custodial wallet for x402.
 *      Top up by sending USDC from any Solana wallet (Phantom, Solflare,
 *      Backpack) via Solana Pay QR or direct address copy.
 *
 * Both rails sit on a soft crystalline ambient background that subtly hints
 * at the underlying treasury without competing with content.
 */

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
    ArrowUpRight,
    CheckCircle2,
    ChevronDown,
    Copy,
    ExternalLink,
    Loader2,
    Plus,
    QrCode,
    RefreshCcw,
    ShieldCheck,
} from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { DreyvStar } from "@/components/studio/DreyvStar";
import {
    PaystackLogo,
    PhantomLogo,
    SolLogo,
    StripeLogo,
    UsdcLogo,
} from "@/components/billing/PaymentLogos";
import walletBg from "@/assets/wallet-bg.jpg";

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

const PREPAID_PRESETS = [25, 100, 500];
const MIN_TOPUP = 5;
const MAX_TOPUP = 10000;

function formatUsd(value: string | null | undefined): string {
    if (!value) return "$0.00";
    const n = Number(value);
    if (!Number.isFinite(n)) return "$0.00";
    return n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
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
    const [prepaidAmount, setPrepaidAmount] = useState<number>(100);
    const [customMode, setCustomMode] = useState(false);
    const [customInput, setCustomInput] = useState<string>("");
    const [topupLoading, setTopupLoading] = useState<"stripe" | "paystack" | null>(null);
    const [topupError, setTopupError] = useState<string | null>(null);

    const startTopup = useCallback(
        async (provider: "stripe" | "paystack", amount: number) => {
            setTopupError(null);
            setTopupLoading(provider);
            try {
                const res = await fetch(`/api/billing/topup/${provider}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ amount }),
                });
                const body = await res.json().catch(() => ({} as { url?: string; error?: string }));
                if (!res.ok || !body?.url) {
                    setTopupError(body?.error || `Failed to start ${provider} checkout`);
                    setTopupLoading(null);
                    return;
                }
                window.location.href = body.url;
            } catch (err) {
                setTopupError(err instanceof Error ? err.message : "Network error");
                setTopupLoading(null);
            }
        },
        [],
    );

    const customParsed = Number(customInput);
    const customValid =
        customMode &&
        customInput.trim() !== "" &&
        Number.isFinite(customParsed) &&
        customParsed >= MIN_TOPUP &&
        customParsed <= MAX_TOPUP;
    const effectiveAmount = customMode
        ? customValid
            ? Math.round(customParsed * 100) / 100
            : null
        : prepaidAmount;

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        else setRefreshing(true);
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

    useEffect(() => {
        load();
    }, [load]);

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
        ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(solanaPayUrl)}`
        : null;

    const usdcBalance = data?.usdc.balance ?? "—";
    const solBalance = data?.sol.balance != null ? data.sol.balance.toFixed(4) : "—";
    const lowSol = data?.sol.balance != null && data.sol.balance < 0.001;

    return (
        <section className="relative overflow-hidden rounded-[28px] border border-violet-100 bg-white">
            {/* Ambient crystal background — visible but never competing */}
            <div className="pointer-events-none absolute inset-0 -z-0">
                <Image
                    src={walletBg}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, 720px"
                    className="object-cover opacity-60"
                    priority={false}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-white/65 to-white/85" />
            </div>

            <div className="relative z-10 p-6 md:p-8">
                {/* Header */}
                <header className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <DreyvStar className="h-3 w-3 text-violet-600" />
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                                Agent treasury
                            </p>
                        </div>
                        <h3 className="mt-2 text-[20px] font-semibold leading-tight tracking-tight text-slate-900">
                            Fund your agent in one place
                        </h3>
                        <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-500">
                            Two rails, one workflow. Prepaid credits for metered capability
                            calls, hosted Solana wallet for on-chain settlement via{" "}
                            <code className="rounded bg-violet-50 px-1 py-0.5 font-mono text-[11px] text-violet-700">
                                x402
                            </code>
                            .
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => load(true)}
                        disabled={loading || refreshing}
                        aria-label="Refresh wallet"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-white/80 text-violet-700 backdrop-blur transition hover:bg-violet-50 disabled:opacity-50"
                    >
                        <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    </button>
                </header>

                {loading ? (
                    <div className="mt-8 flex items-center gap-2 text-[13px] text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading wallet…
                    </div>
                ) : error ? (
                    <div className="mt-8 rounded-2xl border border-red-200 bg-red-50/80 p-4 text-[13px] text-red-700">
                        <p className="font-medium">Couldn&apos;t load the agent wallet.</p>
                        <p className="mt-1 text-[12px]">{error}</p>
                    </div>
                ) : data ? (
                    <>
                        {/* Rail 1 — Prepaid balance */}
                        <article className="relative mt-6 overflow-hidden rounded-2xl border border-violet-200/80 bg-white/85 backdrop-blur-sm">
                            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/70 to-transparent" />
                            <div className="flex items-center gap-3 px-5 pt-4">
                                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-violet-200 bg-white">
                                    <UsdcLogo size={22} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">
                                        Dreyv prepaid balance
                                    </p>
                                    <p className="text-[12px] leading-snug text-slate-500">
                                        Charged per capability call · settles instantly
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-mono text-[26px] font-semibold leading-none tabular-nums text-slate-900">
                                        {formatUsd(data.prepaid?.balance)}
                                    </p>
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                                        USDC credits
                                    </p>
                                </div>
                            </div>

                            {/* Top-up amounts */}
                            <div className="mt-4 flex flex-wrap items-center gap-1.5 px-5">
                                {PREPAID_PRESETS.map((amt) => {
                                    const active = !customMode && prepaidAmount === amt;
                                    return (
                                        <button
                                            key={amt}
                                            type="button"
                                            onClick={() => {
                                                setCustomMode(false);
                                                setPrepaidAmount(amt);
                                            }}
                                            className={`h-8 min-w-[56px] rounded-full px-3 text-[12px] font-semibold tabular-nums transition ${
                                                active
                                                    ? "bg-violet-600 text-white shadow-sm shadow-violet-600/25"
                                                    : "border border-violet-200 bg-white text-slate-700 hover:bg-violet-50"
                                            }`}
                                        >
                                            ${amt}
                                        </button>
                                    );
                                })}
                                {customMode ? (
                                    <div
                                        className={`flex h-8 items-center gap-1 rounded-full border bg-white pl-2.5 pr-1 transition ${
                                            customInput && !customValid
                                                ? "border-red-300"
                                                : "border-violet-400 ring-2 ring-violet-100"
                                        }`}
                                    >
                                        <span className="text-[12px] font-semibold text-slate-500">$</span>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            min={MIN_TOPUP}
                                            max={MAX_TOPUP}
                                            step="1"
                                            autoFocus
                                            value={customInput}
                                            onChange={(e) => setCustomInput(e.target.value)}
                                            placeholder="Amount"
                                            className="h-7 w-24 bg-transparent text-[12px] font-semibold tabular-nums text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setCustomMode(false);
                                                setCustomInput("");
                                            }}
                                            className="text-[10px] font-medium uppercase tracking-wider text-slate-400 hover:text-slate-600"
                                            aria-label="Cancel custom amount"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCustomMode(true);
                                            setCustomInput(String(prepaidAmount));
                                        }}
                                        className="h-8 rounded-full border border-dashed border-violet-300 bg-white px-3 text-[12px] font-semibold text-violet-700 transition hover:bg-violet-50"
                                    >
                                        Custom
                                    </button>
                                )}
                                <div className="ml-auto text-[10px] uppercase tracking-[0.14em] text-slate-400">
                                    Top up
                                </div>
                            </div>
                            {customMode && customInput && !customValid && (
                                <p className="mt-1.5 px-5 text-[11px] text-red-600">
                                    Enter an amount between ${MIN_TOPUP} and ${MAX_TOPUP.toLocaleString()}.
                                </p>
                            )}

                            {/* Provider CTAs */}
                            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-violet-100 bg-violet-50/40 p-3">
                                <button
                                    type="button"
                                    disabled={effectiveAmount == null || topupLoading != null}
                                    onClick={() => effectiveAmount != null && startTopup("stripe", effectiveAmount)}
                                    className="group flex items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white px-3 py-2.5 transition hover:border-violet-300 hover:shadow-sm disabled:cursor-not-allowed disabled:bg-white/50 disabled:opacity-60 disabled:hover:border-violet-100 disabled:hover:shadow-none"
                                >
                                    <span className="flex items-center gap-2">
                                        <StripeLogo size={20} />
                                        <span className="text-[12px] font-medium text-slate-800 group-disabled:text-slate-500">
                                            {topupLoading === "stripe" ? "Redirecting…" : "Card · Stripe"}
                                        </span>
                                    </span>
                                    {effectiveAmount != null && topupLoading !== "stripe" && (
                                        <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 transition group-hover:text-violet-600" />
                                    )}
                                </button>
                                <button
                                    type="button"
                                    disabled={effectiveAmount == null || topupLoading != null}
                                    onClick={() => effectiveAmount != null && startTopup("paystack", effectiveAmount)}
                                    className="group flex items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white px-3 py-2.5 transition hover:border-violet-300 hover:shadow-sm disabled:cursor-not-allowed disabled:bg-white/50 disabled:opacity-60 disabled:hover:border-violet-100 disabled:hover:shadow-none"
                                    title="Charged in GHS at today's USD→GHS rate"
                                >
                                    <span className="flex items-center gap-2">
                                        <PaystackLogo size={18} />
                                        <span className="text-[12px] font-medium text-slate-800 group-disabled:text-slate-500">
                                            {topupLoading === "paystack" ? "Redirecting…" : "Mobile money · Paystack"}
                                        </span>
                                    </span>
                                    {effectiveAmount != null && topupLoading !== "paystack" && (
                                        <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 transition group-hover:text-violet-600" />
                                    )}
                                </button>
                            </div>
                            {topupError && (
                                <p className="mt-1.5 px-5 pb-2 text-[11px] text-red-600">{topupError}</p>
                            )}
                            <p className="mt-1 px-5 pb-3 text-[10.5px] text-slate-500">
                                Stripe charges in USD. Paystack converts to GHS at today's rate.
                            </p>
                        </article>

                        {/* Rail 2 — Hosted on-chain wallet */}
                        <article className="relative mt-3 overflow-hidden rounded-2xl border border-violet-100 bg-white/85 backdrop-blur-sm">
                            <div className="flex items-center gap-3 px-5 pt-4">
                                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-violet-200 bg-white">
                                    <SolLogo size={20} />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">
                                        Dreyv hosted wallet
                                    </p>
                                    <p className="text-[12px] leading-snug text-slate-500">
                                        Custodial · Solana mainnet · pays via x402
                                    </p>
                                </div>
                                <div className="flex flex-col items-end">
                                    <div className="flex items-baseline gap-1.5">
                                        <span className="font-mono text-[18px] font-semibold tabular-nums text-slate-900">
                                            {usdcBalance}
                                        </span>
                                        <span className="text-[10px] uppercase tracking-wider text-slate-400">
                                            USDC
                                        </span>
                                    </div>
                                    <div className="mt-0.5 flex items-baseline gap-1.5">
                                        <span
                                            className={`font-mono text-[11px] tabular-nums ${
                                                lowSol ? "text-amber-700" : "text-slate-500"
                                            }`}
                                        >
                                            {solBalance}
                                        </span>
                                        <span className="text-[9px] uppercase tracking-wider text-slate-400">
                                            SOL · fees
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Address row */}
                            <div className="mx-5 mt-4 flex h-10 items-center gap-2 rounded-xl border border-violet-100 bg-white/80 px-3">
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
                            </div>

                            {/* Top-up control */}
                            <div className="mt-3 flex items-center justify-between gap-3 border-t border-violet-100 bg-violet-50/40 px-5 py-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                        Send from
                                    </span>
                                    <div className="flex items-center -space-x-1.5">
                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white bg-white ring-1 ring-violet-100">
                                            <PhantomLogo size={18} />
                                        </span>
                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white bg-white ring-1 ring-violet-100">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src="/brand/solflare.svg" alt="Solflare" width={16} height={16} />
                                        </span>
                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white bg-white ring-1 ring-violet-100">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src="/brand/backpack.png" alt="Backpack" width={16} height={16} className="rounded-full object-contain" />
                                        </span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowQr((v) => !v)}
                                    aria-expanded={showQr}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm shadow-violet-600/25 transition hover:bg-violet-700"
                                >
                                    {showQr ? (
                                        <ChevronDown className="h-3.5 w-3.5 rotate-180 transition-transform" />
                                    ) : (
                                        <Plus className="h-3.5 w-3.5" />
                                    )}
                                    {showQr ? "Hide QR" : "Top up wallet"}
                                </button>
                            </div>

                            {/* QR reveal */}
                            {showQr && qrUrl && (
                                <div className="flex items-center gap-4 border-t border-violet-100 bg-white px-5 py-4">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={qrUrl}
                                        alt="Solana Pay top-up QR"
                                        width={132}
                                        height={132}
                                        className="rounded-xl border border-violet-100 bg-white p-1.5"
                                    />
                                    <div className="min-w-0 text-[12px] leading-relaxed text-slate-600">
                                        <div className="flex items-center gap-1.5">
                                            <QrCode className="h-3.5 w-3.5 text-violet-600" />
                                            <p className="font-semibold text-slate-900">Scan with any Solana wallet</p>
                                        </div>
                                        <p className="mt-1 text-[11px] text-slate-500">
                                            Solana Pay — opens directly in Phantom, Solflare, and
                                            Backpack. Send USDC and a small SOL float (~0.01) for fees.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </article>

                        {/* Footer — safety + disclosure */}
                        <div className="mt-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                <ShieldCheck className="h-3 w-3 text-violet-600" />
                                Keys encrypted at rest · custodial for invoice settlement only
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowHelp((v) => !v)}
                                aria-expanded={showHelp}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:underline"
                            >
                                <ChevronDown
                                    className={`h-3 w-3 transition-transform ${showHelp ? "rotate-180" : ""}`}
                                />
                                {showHelp ? "Hide" : "How funding works"}
                            </button>
                        </div>
                        {showHelp && (
                            <div className="mt-3 rounded-2xl border border-violet-100 bg-white/70 p-4 text-[12px] leading-relaxed text-slate-700">
                                <p className="mb-2 font-semibold text-slate-900">Two rails, one agent:</p>
                                <ul className="space-y-1.5">
                                    <li>
                                        <strong className="text-violet-700">Prepaid balance</strong> — fund with a
                                        card or mobile money. Each capability call debits USDC credits
                                        with sub-second settlement. Best for SaaS-style metered usage.
                                    </li>
                                    <li>
                                        <strong className="text-violet-700">Hosted wallet</strong> — send USDC
                                        on Solana. Agents call{" "}
                                        <code className="font-mono text-[11px]">POST /api/x402/pay</code> for
                                        per-invoice settlement. Keep just enough for upcoming calls.
                                    </li>
                                </ul>
                                <p className="mt-3 text-[11px] text-slate-500">
                                    Don&apos;t use the hosted wallet as a treasury — it&apos;s designed
                                    for short-lived float, not custody.
                                </p>
                            </div>
                        )}
                    </>
                ) : null}
            </div>
        </section>
    );
}
