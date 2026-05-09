"use client";

/**
 * CryptoPayPanel — Phase 1 manual crypto checkout (Solana: USDC / USDT / SOL).
 *
 * Flow: pick tier+asset → POST /api/billing/crypto/checkout → render payment
 * card with receiving address + amount + memo → user pays from any Solana
 * wallet → pastes the tx signature → POST /api/billing/crypto/verify → tier
 * flips on confirmation.
 */
import React, { useEffect, useState } from "react";
import { Loader2, Copy, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { DreyvStar } from "@/components/studio/DreyvStar";

type Tier = "mini" | "max";
type Asset = "usdc" | "usdt" | "sol";

interface Invoice {
    id: string;
    tier: Tier;
    chain: "solana";
    asset: Asset;
    amount: string;
    amountUsd: number;
    receivingAddress: string;
    memo: string;
    expiresAt: string;
}

const ASSETS: { id: Asset; label: string }[] = [
    { id: "usdc", label: "USDC" },
    { id: "usdt", label: "USDT" },
    { id: "sol",  label: "SOL"  },
];

export function CryptoPayPanel({ onConfirmed, initialTier }: { onConfirmed?: (tier: Tier) => void; initialTier?: Tier }) {
    const [tier, setTier] = useState<Tier>(initialTier ?? "mini");
    const [asset, setAsset] = useState<Asset>("usdc");
    const [creating, setCreating] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [signature, setSignature] = useState("");
    const [pricing, setPricing] = useState<{ mini: number; max: number } | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/billing/crypto/pricing", { cache: "no-store" })
            .then(r => r.json())
            .then(d => {
                if (cancelled || !d?.tiers) return;
                setPricing({ mini: d.tiers.mini.usd, max: d.tiers.max.usd });
            })
            .catch(() => { /* fall back to invoice.amountUsd */ });
        return () => { cancelled = true; };
    }, []);

    const tierUsd = (t: Tier) => pricing ? pricing[t].toFixed(2) : "…";
    const usd = tierUsd(tier);

    async function startCheckout() {
        setCreating(true);
        try {
            const res = await fetch("/api/billing/crypto/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tier, chain: "solana", asset }),
            });
            const data = await res.json();
            if (!res.ok || !data.invoice) {
                toast.error(data?.error || "Failed to create invoice.");
                return;
            }
            setInvoice(data.invoice);
        } catch {
            toast.error("Failed to start crypto checkout.");
        } finally {
            setCreating(false);
        }
    }

    async function submitVerify() {
        if (!invoice || !signature.trim()) return;
        setVerifying(true);
        try {
            const res = await fetch("/api/billing/crypto/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ invoiceId: invoice.id, signature: signature.trim() }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(`Verification failed: ${data?.reason || data?.error || "unknown"}`);
                return;
            }
            toast.success(`Subscription active — ${String(data.tier).toUpperCase()}`);
            onConfirmed?.(data.tier);
            setInvoice(null);
            setSignature("");
        } catch {
            toast.error("Failed to verify payment.");
        } finally {
            setVerifying(false);
        }
    }

    const copy = (text: string, what: string) => {
        navigator.clipboard?.writeText(text);
        toast.success(`${what} copied`);
    };

    return (
        <section className="mt-12 rounded-3xl border border-violet-100 bg-white p-7">
            <div className="flex items-center gap-2.5 mb-4">
                <DreyvStar size={10} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">
                    Pay with crypto · 10% off
                </span>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900">Settle in stables or SOL</h3>
                    <p className="mt-1 text-[13px] text-slate-500">
                        Solana payments today (USDC, USDT, SOL). Base, Arbitrum, Polygon and BNB Chain coming next.
                        Prices include a 10% discount vs card.
                    </p>

                    <div className="mt-5 space-y-4">
                        <div>
                            <label className="text-[10px] font-semibold tracking-[0.18em] uppercase text-slate-500">Tier</label>
                            <div className="mt-2 inline-flex rounded-xl border border-violet-100 p-1">
                                {(["mini", "max"] as Tier[]).map(t => (
                                    <button
                                        key={t}
                                        onClick={() => setTier(t)}
                                        disabled={!!invoice}
                                        className={
                                            tier === t
                                                ? "px-4 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white"
                                                : "px-4 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:text-violet-700"
                                        }
                                    >
                                        {t === "mini" ? `Mini · $${tierUsd("mini")}` : `Max · $${tierUsd("max")}`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] font-semibold tracking-[0.18em] uppercase text-slate-500">Asset (Solana)</label>
                            <div className="mt-2 inline-flex rounded-xl border border-violet-100 p-1">
                                {ASSETS.map(a => (
                                    <button
                                        key={a.id}
                                        onClick={() => setAsset(a.id)}
                                        disabled={!!invoice}
                                        className={
                                            asset === a.id
                                                ? "px-4 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 text-white"
                                                : "px-4 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:text-violet-700"
                                        }
                                    >
                                        {a.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {!invoice && (
                            <button
                                onClick={startCheckout}
                                disabled={creating}
                                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 px-5 py-2.5 text-xs font-semibold text-white uppercase tracking-[0.06em] transition disabled:opacity-60"
                            >
                                {creating
                                    ? <><Loader2 size={13} className="animate-spin" /> Creating invoice</>
                                    : <><ArrowRight size={13} /> Generate payment for {tier === "mini" ? "Mini" : "Max"} (${usd})</>}
                            </button>
                        )}
                    </div>
                </div>

                <div>
                    {invoice ? (
                        <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5 space-y-4">
                            <div>
                                <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet-700">Send exactly</div>
                                <div className="mt-1 text-2xl font-semibold text-slate-900">
                                    {invoice.amount} <span className="text-sm font-medium text-slate-500">{invoice.asset.toUpperCase()}</span>
                                </div>
                                <div className="text-[11px] text-slate-500">≈ ${invoice.amountUsd.toFixed(2)} USD · expires {new Date(invoice.expiresAt).toLocaleTimeString()}</div>
                            </div>

                            <div>
                                <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-500">Recipient (Solana)</div>
                                <button onClick={() => copy(invoice.receivingAddress, "Address")} className="mt-1 flex items-center gap-2 text-[12px] font-mono text-slate-800 hover:text-violet-700 break-all text-left">
                                    {invoice.receivingAddress} <Copy size={12} className="shrink-0" />
                                </button>
                            </div>

                            <div>
                                <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-500">Memo (required)</div>
                                <button onClick={() => copy(invoice.memo, "Memo")} className="mt-1 flex items-center gap-2 text-[12px] font-mono text-slate-800 hover:text-violet-700">
                                    {invoice.memo} <Copy size={12} />
                                </button>
                                <p className="mt-1 text-[11px] text-slate-500">Attach this memo using the SPL Memo program — without it we can&apos;t match your payment.</p>
                            </div>

                            <div>
                                <label className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-500">Paste tx signature after sending</label>
                                <input
                                    value={signature}
                                    onChange={e => setSignature(e.target.value)}
                                    placeholder="5x...solana tx signature"
                                    className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-[12px] font-mono text-slate-800 focus:outline-none focus:border-violet-500"
                                />
                                <button
                                    onClick={submitVerify}
                                    disabled={verifying || !signature.trim()}
                                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 px-4 py-2 text-xs font-semibold text-white uppercase tracking-[0.06em] transition disabled:opacity-60"
                                >
                                    {verifying
                                        ? <><Loader2 size={13} className="animate-spin" /> Verifying</>
                                        : <><CheckCircle2 size={13} /> Verify payment</>}
                                </button>
                                <button
                                    onClick={() => { setInvoice(null); setSignature(""); }}
                                    className="ml-3 text-[11px] text-slate-500 hover:text-slate-800 uppercase tracking-[0.16em] font-semibold"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/30 p-5 text-[12px] text-slate-600">
                            Generate an invoice on the left to get the recipient address, exact amount, and memo. After paying from any Solana wallet, paste the transaction signature to activate your subscription.
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
