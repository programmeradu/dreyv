"use client";

/**
 * Billing & subscription — Stitch-light Dreyv aesthetic.
 *
 * White shell, solid violet accents, DreyvStar marks, no terminal styling.
 * Paystack-powered subscription checkout (Mini / Max).
 * Reads ?paystack=verify on mount to reconcile a returning checkout.
 */
import React, { useState, useEffect, useCallback } from "react";
import Image, { type StaticImageData } from "next/image";
import { useSearchParams } from "next/navigation";
import { toast } from "@/lib/toast-notifications";
import { billingCheckoutPath, billingStatusPath } from "@/lib/billing-endpoints";
import {
    CheckCircle2,
    ArrowRight,
    Loader2,
    RefreshCw,
} from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { CryptoPayPanel } from "@/components/billing/CryptoPayPanel";
import { useVault } from "@/lib/contexts/VaultContext";
import { StripeLogo, PaystackLogo, UsdcLogo, UsdtLogo, SolLogo } from "@/components/billing/PaymentLogos";
import tierBase from "@/assets/tier-base.png";
import tierMini from "@/assets/tier-mini.png";
import tierMax from "@/assets/tier-max.png";
import dreyvBilling from "@/assets/mascot/dreyv-celebrate.png";

type Tier = "free" | "mini" | "max";

const TIER_DEF: Array<{
    id: Tier;
    label: string;
    tagline: string;
    price: string;
    image: StaticImageData;
    imageAlt: string;
    features: string[];
    featured?: boolean;
}> = [
    {
        id: "free",
        label: "Base",
        tagline: "Free forever",
        price: "$0",
        image: tierBase,
        imageAlt: "Violet crystal shard representing the Base tier",
        features: [
            "1 multisig vault",
            "Up to 3 teammates",
            "Basic command prompts",
            "Standard security routing",
        ],
    },
    {
        id: "mini",
        label: "Mini",
        tagline: "Growing squads",
        price: "$49",
        image: tierMini,
        imageAlt: "Stack of violet crystal shards representing the Mini tier",
        features: [
            "Up to 5 multisig vaults",
            "10 teammates per vault",
            "Advanced DCA + AI integrations",
            "Custom webhooks",
            "Priority network finality",
        ],
        featured: true,
    },
    {
        id: "max",
        label: "Max",
        tagline: "Enterprise nexus",
        price: "$199",
        image: tierMax,
        imageAlt: "Violet obelisk monolith representing the Max tier",
        features: [
            "Unlimited multisig vaults",
            "Unlimited teammates",
            "Dedicated backend compute",
            "White-glove integration",
            "Automated treasury yield",
            "Dedicated node RPCs",
        ],
    },
];

export default function BillingPage() {
    const search = useSearchParams();
    const { activeVault } = useVault();
    const [loading, setLoading] = useState<Tier | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [currentTier, setCurrentTier] = useState<Tier>("free");
    const [status, setStatus] = useState<string>("");
    const [picker, setPicker] = useState<Exclude<Tier, "free"> | null>(null);
    const [cryptoSeed, setCryptoSeed] = useState<{ tier: Exclude<Tier, "free">; nonce: number } | null>(null);
    const [cryptoPricing, setCryptoPricing] = useState<{ mini: number; max: number } | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/billing/crypto/pricing", { cache: "no-store" })
            .then(r => r.json())
            .then(d => { if (!cancelled && d?.tiers) setCryptoPricing({ mini: d.tiers.mini.usd, max: d.tiers.max.usd }); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const fetchStatus = useCallback(async (reference?: string | null) => {
        const url = reference
            ? `${billingStatusPath()}?reference=${encodeURIComponent(reference)}`
            : billingStatusPath();
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.tier) setCurrentTier(data.tier as Tier);
            if (data.status) setStatus(data.status);
            return data;
        } catch {
            return null;
        }
    }, []);

    // Hydrate + handle Paystack callback
    useEffect(() => {
        const isCallback = search?.get("paystack") === "verify";
        const reference = search?.get("reference") || search?.get("trxref") || null;
        if (isCallback) {
            (async () => {
                setVerifying(true);
                const data = await fetchStatus(reference);
                setVerifying(false);
                if (data?.reconciled && data?.tier && data.tier !== "free") {
                    toast.success(`Subscription active — ${String(data.tier).toUpperCase()}`);
                } else if (data?.tier === "free") {
                    toast.info("We couldn't find an active subscription yet — try Verify in a moment.");
                }
                // clean URL
                if (typeof window !== "undefined") {
                    const u = new URL(window.location.href);
                    u.searchParams.delete("paystack");
                    u.searchParams.delete("reference");
                    u.searchParams.delete("trxref");
                    window.history.replaceState({}, "", u.toString());
                }
            })();
        } else {
            fetchStatus();
        }
    }, [search, fetchStatus]);

    const startPaystack = async (tier: Exclude<Tier, "free">) => {
        setLoading(tier);
        try {
            const res = await fetch(billingCheckoutPath(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tier }),
            });
            const data = await res.json();
            if (data?.url) {
                window.location.href = data.url;
                return;
            }
            toast.error(data?.error || "Failed to generate checkout link.");
        } catch {
            toast.error("Failed to start checkout.");
        } finally {
            setLoading(null);
        }
    };

    const choosePaymentMethod = (tier: Tier) => {
        if (tier === "free") return;
        setPicker(tier as Exclude<Tier, "free">);
    };

    const pickCard = () => {
        if (!picker) return;
        const t = picker;
        setPicker(null);
        startPaystack(t);
    };

    const pickCrypto = () => {
        if (!picker) return;
        setCryptoSeed({ tier: picker, nonce: Date.now() });
        setPicker(null);
        // Scroll to crypto panel after render
        requestAnimationFrame(() => {
            document.getElementById("crypto-pay-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    };

    const handleVerify = async () => {
        setVerifying(true);
        const data = await fetchStatus();
        setVerifying(false);
        if (data?.reconciled) {
            toast.success(`Tier reconciled — ${String(data.tier).toUpperCase()}`);
        } else if (data?.tier === "free") {
            toast.info("No active subscription found.");
        } else if (data?.tier) {
            toast.success(`Active: ${String(data.tier).toUpperCase()} (${data.status || "current"})`);
        }
    };

    const isPaid = currentTier !== "free";

    return (
        <div className="flex-1 w-full bg-white text-slate-900 font-manrope min-h-screen">
            {/* Header */}
            <header className="relative border-b border-violet-100 bg-white overflow-hidden">
                <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-violet-300/20 blur-3xl" />
                <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-64 w-64 rounded-full bg-violet-400/10 blur-3xl" />

                {/* Dreyv mascot peek — celebrate on paid, greet on free */}
                <div className="pointer-events-none hidden md:block absolute right-6 lg:right-10 bottom-0 translate-y-3 z-0 select-none">
                    <Image
                        src={dreyvBilling}
                        alt=""
                        width={140}
                        height={140}
                        priority
                        className="h-[120px] w-auto opacity-95 drop-shadow-[0_18px_30px_rgba(124,58,237,0.18)]"
                    />
                </div>

                <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-7 flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <DreyvStar size={10} className="text-violet-600" />
                            <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">
                                Billing & subscription
                            </span>
                        </div>
                        <h1 className="mt-2 text-[26px] sm:text-[28px] font-semibold tracking-[-0.01em] text-slate-900">
                            Plans, payments, and capacity
                        </h1>
                        <p className="mt-1 text-[13px] text-slate-500 max-w-xl">
                            {isPaid
                                ? "Billed monthly via Paystack. Manage invoices and payment method directly from your Paystack receipt email."
                                : "You're on the free tier. Upgrade for more vaults, seats, and AI capacity."}
                        </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                        <span
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase ${
                                isPaid
                                    ? "bg-violet-50 text-violet-700 border-violet-200"
                                    : "bg-slate-100 text-slate-600 border-slate-200"
                            }`}
                        >
                            <DreyvStar size={7} className={isPaid ? "text-violet-600" : "text-slate-400"} />
                            {isPaid ? `Active · ${status || currentTier}` : "Free tier"}
                        </span>
                        <button
                            onClick={handleVerify}
                            disabled={verifying}
                            className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase text-slate-500 hover:text-violet-700 transition disabled:opacity-50"
                        >
                            {verifying ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                            Verify status
                        </button>
                    </div>
                </div>
            </header>

            {/* Tiers */}
            <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {TIER_DEF.map((tier) => {
                        const isCurrent = currentTier === tier.id;
                        const isLoading = loading === tier.id;

                        return (
                            <div
                                key={tier.id}
                                className={
                                    tier.featured
                                        ? "relative rounded-3xl border-2 border-violet-600 bg-white p-7 flex flex-col"
                                        : "rounded-3xl border border-violet-100 bg-white p-7 flex flex-col hover:border-violet-300 transition"
                                }
                            >
                                {tier.featured && (
                                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                                        Most popular
                                    </span>
                                )}

                                <div className="flex items-center gap-4 mb-5">
                                    <div className="h-16 w-16 shrink-0 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center overflow-hidden">
                                        <Image
                                            src={tier.image}
                                            alt={tier.imageAlt}
                                            width={56}
                                            height={56}
                                            className="h-14 w-14 object-contain"
                                        />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-semibold text-slate-900">{tier.label}</h2>
                                        <p className="text-[11px] text-slate-500">{tier.tagline}</p>
                                    </div>
                                </div>

                                <div className="flex items-baseline gap-1">
                                    <span className="text-4xl font-semibold tracking-tight text-slate-900">{tier.price}</span>
                                    <span className="text-sm font-medium text-slate-500">/mo</span>
                                </div>
                                <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 font-medium">
                                    {tier.id === "free" ? "No card required" : "Billed monthly via Paystack"}
                                </p>

                                <ul className="mt-6 space-y-3 flex-1">
                                    {tier.features.map((f) => (
                                        <li key={f} className="flex items-start gap-2.5 text-sm text-slate-700">
                                            <CheckCircle2 size={14} className="text-violet-600 mt-0.5 shrink-0" />
                                            <span>{f}</span>
                                        </li>
                                    ))}
                                </ul>

                                <div className="mt-8">
                                    {isCurrent ? (
                                        <button
                                            disabled
                                            className="w-full rounded-xl border border-violet-200 bg-violet-50 px-5 py-2.5 text-xs font-semibold text-violet-700 uppercase tracking-[0.06em]"
                                        >
                                            Current plan
                                        </button>
                                    ) : tier.id === "free" ? (
                                        <button
                                            disabled
                                            className="w-full rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-[0.06em]"
                                        >
                                            Free forever
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => choosePaymentMethod(tier.id)}
                                            disabled={isLoading}
                                            className={
                                                tier.featured
                                                    ? "inline-flex w-full justify-center items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 px-5 py-2.5 text-xs font-semibold text-white uppercase tracking-[0.06em] transition disabled:opacity-60"
                                                    : "inline-flex w-full justify-center items-center gap-2 rounded-xl border border-violet-200 bg-white hover:border-violet-400 hover:text-violet-700 px-5 py-2.5 text-xs font-semibold text-slate-800 uppercase tracking-[0.06em] transition disabled:opacity-60"
                                            }
                                        >
                                            {isLoading ? (
                                                <>
                                                    <Loader2 size={13} className="animate-spin" /> Initializing
                                                </>
                                            ) : (
                                                <>
                                                    <ArrowRight size={13} /> Upgrade to {tier.label}
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div id="crypto-pay-panel">
                    <CryptoPayPanel
                        key={cryptoSeed?.nonce ?? "default"}
                        initialTier={cryptoSeed?.tier}
                        onConfirmed={(t) => setCurrentTier(t)}
                        walletAddress={activeVault ?? undefined}
                    />
                </div>


                <p className="mt-8 text-center text-[11px] text-slate-500">
                    Prices in USD. Card payments via Paystack. Crypto payments settle on-chain (Solana today; EVM coming).
                </p>
            </main>

            {picker && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setPicker(null)}>
                    <div
                        role="dialog"
                        aria-label="Choose payment method"
                        className="w-full max-w-md rounded-3xl border border-violet-100 bg-white p-7"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-2.5">
                            <DreyvStar size={10} className="text-violet-600" />
                            <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">
                                Upgrade to {picker === "mini" ? "Mini" : "Max"}
                            </span>
                        </div>
                        <h3 className="mt-2 text-lg font-semibold text-slate-900">Choose how to pay</h3>
                        <p className="mt-1 text-[13px] text-slate-500">
                            Card billing is recurring monthly via Paystack. Crypto payments are manual per cycle and include a 10% discount.
                        </p>

                        <div className="mt-5 space-y-3">
                            <button
                                onClick={pickCard}
                                disabled={loading === picker}
                                className="w-full flex items-center justify-between gap-3 rounded-2xl border border-violet-100 hover:border-violet-300 bg-white px-4 py-3 text-left transition disabled:opacity-60"
                            >
                                <div className="flex items-center gap-3">
                                    <PaystackLogo size={22} />
                                    <div>
                                        <div className="text-sm font-semibold text-slate-900">Card · Paystack</div>
                                        <div className="text-[12px] text-slate-500">Auto-renews monthly · ${picker === "mini" ? "49" : "199"}/mo</div>
                                    </div>
                                </div>
                                {loading === picker ? <Loader2 size={14} className="animate-spin text-violet-600" /> : <ArrowRight size={14} className="text-violet-600" />}
                            </button>
                            <button
                                onClick={pickCrypto}
                                className="w-full flex items-center justify-between gap-3 rounded-2xl border-2 border-violet-600 bg-violet-50/40 px-4 py-3 text-left transition hover:bg-violet-50"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="flex -space-x-1.5">
                                        <UsdcLogo size={22} className="ring-2 ring-white rounded-full" />
                                        <UsdtLogo size={22} className="ring-2 ring-white rounded-full" />
                                        <SolLogo size={22} className="ring-2 ring-white rounded-full" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-semibold text-slate-900">Crypto · 10% off</div>
                                        <div className="text-[12px] text-slate-500">USDC / USDT / SOL · ${cryptoPricing ? cryptoPricing[picker].toFixed(2) : "…"} per cycle · or top up via Stripe</div>
                                    </div>
                                </div>
                                <ArrowRight size={14} className="text-violet-600" />
                            </button>
                        </div>

                        <button
                            onClick={() => setPicker(null)}
                            className="mt-5 text-[11px] text-slate-500 hover:text-slate-800 uppercase tracking-[0.16em] font-semibold"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
