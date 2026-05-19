"use client";

/**
 * EvmExplorerClient — minimal v2 explorer for 0x addresses.
 *
 * Re-uses the existing /api/evm/holdings route across all 5 supported chains
 * (Ethereum, Base, Arbitrum, Polygon, BSC), aggregates total USD, and pipes
 * the user to /auth?claim=… or /waitlist for the full agent surface.
 * Solana-only pieces (multisig, cNFTs, Squads) are intentionally hidden.
 */

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Copy, Layers, Wallet } from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { TokenAvatar } from "@/components/TokenAvatar";

const CHAINS = ["ethereum", "base", "arbitrum", "polygon", "bsc"] as const;
type Chain = typeof CHAINS[number];

interface Holding {
    mint?: string;
    address?: string;
    symbol: string;
    name?: string;
    balance: string;
    decimals: number;
    logo?: string;
    price?: number;
    value?: number;
}

const fmtUsd = (n: number) => Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : Math.abs(n) >= 1_000 ? `$${(n / 1_000).toFixed(1)}k` : `$${n.toFixed(2)}`;
const truncAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function EvmExplorerClient({ address, embed }: { address: string; embed?: boolean }) {
    const [chain, setChain] = useState<Chain>("ethereum");
    const [holdings, setHoldings] = useState<Record<Chain, Holding[]>>({ ethereum: [], base: [], arbitrum: [], polygon: [], bsc: [] });
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all(CHAINS.map(c =>
            fetch(`/api/evm/holdings?address=${address}&chain=${c}`, { cache: "no-store" })
                .then(r => r.ok ? r.json() : { holdings: [] })
                .catch(() => ({ holdings: [] }))
        )).then(results => {
            if (cancelled) return;
            const next = { ...holdings };
            CHAINS.forEach((c, i) => { next[c] = Array.isArray(results[i]?.holdings) ? results[i].holdings : []; });
            setHoldings(next);
            setLoading(false);
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    const totals = useMemo(() => {
        const t: Record<Chain, number> = { ethereum: 0, base: 0, arbitrum: 0, polygon: 0, bsc: 0 };
        for (const c of CHAINS) for (const h of holdings[c]) t[c] += h.value ?? 0;
        return t;
    }, [holdings]);
    const grandTotal = useMemo(() => CHAINS.reduce((a, c) => a + totals[c], 0), [totals]);
    const active = holdings[chain] || [];

    const copy = () => {
        navigator.clipboard?.writeText(address);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    return (
        <>
            <div className="relative border-b border-violet-100/80 overflow-hidden">
                <div className="pointer-events-none absolute -top-32 left-1/3 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-violet-400/20 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-40 right-0 h-[320px] w-[520px] rounded-full bg-violet-300/30 blur-3xl" />
                <div className="relative mx-auto max-w-6xl px-6 py-10 sm:py-14">
                    {!embed && (
                        <div className="flex items-center justify-between gap-4 mb-6">
                            <Link href="/" className="text-xs uppercase tracking-[0.22em] font-semibold text-violet-700">Dreyv</Link>
                            <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-mono text-slate-700 hover:border-violet-400">
                                {truncAddr(address)} {copied ? "✓" : <Copy size={10} />}
                            </button>
                        </div>
                    )}
                    <div className="flex items-center gap-2 mb-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 text-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
                            <DreyvStar size={10} className="text-white" />
                            EVM wallet
                        </span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">
                        Multi-chain snapshot for <span className="font-mono text-violet-700">{truncAddr(address)}</span>
                    </h1>
                    <p className="mt-3 max-w-2xl text-[14px] text-slate-600">
                        Holdings across Ethereum, Base, Arbitrum, Polygon, and BNB Chain — pulled live from Alchemy. Connect to unlock the full Dreyv agent surface for this address.
                    </p>
                </div>
            </div>

            <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
                {!embed && (
                    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <Wallet size={18} className="text-violet-600 mt-0.5" />
                            <div>
                                <div className="text-[13px] font-semibold text-slate-900">Connect to act on these insights</div>
                                <div className="text-[11px] text-slate-500">Read-only view. Sign in to enable execution, alerts, and the full agent.</div>
                            </div>
                        </div>
                        <Link href={`/auth?claim=${address}`} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 px-4 py-2 text-[12px] font-semibold text-white uppercase tracking-[0.08em] shrink-0">
                            Connect wallet <ArrowRight size={12} />
                        </Link>
                    </div>
                )}

                {/* Chain totals strip */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {CHAINS.map(c => (
                        <button key={c} onClick={() => setChain(c)} className={`rounded-2xl border p-4 text-left transition ${chain === c ? "border-violet-600 bg-violet-50/40" : "border-violet-100 bg-white hover:border-violet-300"}`}>
                            <div className="text-[9px] uppercase tracking-[0.18em] font-semibold text-violet-700">{c}</div>
                            <div className="mt-1 text-base font-semibold text-slate-900">{fmtUsd(totals[c])}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{holdings[c].length} tokens</div>
                        </button>
                    ))}
                </div>

                <section className="rounded-3xl border border-violet-100 bg-white p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4 mb-5">
                        <div className="flex items-start gap-3">
                            <Layers size={16} className="mt-0.5 text-violet-600" />
                            <div>
                                <h2 className="text-[15px] font-semibold text-slate-900 tracking-tight">Holdings on {chain}</h2>
                                <p className="text-[12px] text-slate-500 mt-0.5">{fmtUsd(totals[chain])} · {active.length} positions</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-[9px] uppercase tracking-[0.18em] font-semibold text-violet-700">All chains</div>
                            <div className="text-base font-semibold text-slate-900">{fmtUsd(grandTotal)}</div>
                        </div>
                    </div>
                    {loading ? (
                        <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded bg-violet-100/60 animate-pulse" />)}</div>
                    ) : active.length === 0 ? (
                        <p className="text-[13px] text-slate-500">No holdings detected on {chain}.</p>
                    ) : (
                        <div className="divide-y divide-violet-50">
                            {active.slice(0, 20).map((h, i) => (
                                <div key={`${h.address ?? h.mint}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <TokenAvatar symbol={h.symbol} mint={h.address ?? h.mint} logo={h.logo} size={28} />
                                        <div className="min-w-0">
                                            <div className="text-[13px] font-semibold text-slate-900 truncate">{h.symbol}</div>
                                            <div className="text-[11px] text-slate-500 font-mono">{Number(h.balance || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-[13px] font-semibold text-slate-900">{fmtUsd(h.value ?? 0)}</div>
                                        <div className="text-[11px] text-slate-500">{h.price ? `@ $${h.price.toFixed(4)}` : "no price"}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {!embed && (
                    <div className="text-center py-6 text-[11px] text-slate-500">
                        Powered by{" "}
                        <Link href="/" className="text-violet-700 font-semibold hover:underline">Dreyv</Link>
                        {" · "}
                        <Link href={`/v/${address}?embed=1`} className="hover:text-violet-700">Embed</Link>
                    </div>
                )}
            </div>

            {!embed && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="fixed bottom-5 right-5 z-40 max-w-sm rounded-2xl border border-violet-200 bg-white shadow-lg shadow-violet-200/30 p-4"
                >
                    <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700">Your wallet?</div>
                    <div className="mt-1 text-[13px] font-semibold text-slate-900">Claim this address on Dreyv</div>
                    <p className="mt-1 text-[11px] text-slate-500">Bridge for gas, simulate trades, and set guardrails across all 5 chains.</p>
                    <Link href={`/auth?claim=${address}`} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-[11px] font-semibold text-white uppercase tracking-[0.08em]">
                        Claim <ArrowRight size={11} />
                    </Link>
                </motion.div>
            )}
        </>
    );
}

export default EvmExplorerClient;
