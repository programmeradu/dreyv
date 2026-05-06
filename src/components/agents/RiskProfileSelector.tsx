"use client";

import React, { useEffect, useState } from "react";
import { Lock, Landmark, Orbit, Rocket } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { useWallet } from "@solana/wallet-adapter-react";

type RiskProfile = "conservative" | "balanced" | "aggressive";

const PROFILES = {
    conservative: {
        id: "conservative" as const,
        name: "Sentinel",
        icon: Landmark,
        description: "Maximum security. Requires approval for almost everything.",
        autoApproveBelowUsd: 100,
        requireMultisigAboveUsd: 1_000,
        dailyValueCapUsd: 5_000,
        color: "text-blue-500",
        bg: "bg-blue-500/10",
        border: "border-blue-500/20",
    },
    balanced: {
        id: "balanced" as const,
        name: "Vanguard",
        icon: Orbit,
        description: "Balanced autonomy. Auto-signs routine transactions.",
        autoApproveBelowUsd: 500,
        requireMultisigAboveUsd: 10_000,
        dailyValueCapUsd: 25_000,
        color: "text-primary",
        bg: "bg-primary/10",
        border: "border-primary/20",
    },
    aggressive: {
        id: "aggressive" as const,
        name: "Maverick",
        icon: Rocket,
        description: "High velocity. Auto-executes trading strategies.",
        autoApproveBelowUsd: 2_000,
        requireMultisigAboveUsd: 50_000,
        dailyValueCapUsd: 100_000,
        color: "text-orange-500",
        bg: "bg-orange-500/10",
        border: "border-orange-500/20",
    },
};

function inferProfileFromThreshold(t: number): RiskProfile {
    if (t <= 200) return "conservative";
    if (t <= 1_000) return "balanced";
    return "aggressive";
}

export const RiskProfileSelector = () => {
    const { publicKey } = useWallet();
    const wallet = publicKey?.toBase58() ?? null;

    const [selectedProfile, setSelectedProfile] = useState<RiskProfile>("balanced");
    const [customThreshold, setCustomThreshold] = useState<number>(PROFILES.balanced.autoApproveBelowUsd);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    // Load existing server policy
    useEffect(() => {
        if (!wallet) {
            setHydrated(true);
            return;
        }
        let abort = false;
        (async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/dacs/policy?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
                const json = await res.json();
                if (!abort && json?.ok && json.policy) {
                    const t = Number(json.policy.autoApproveBelowUsd ?? 0);
                    setCustomThreshold(t);
                    setSelectedProfile(inferProfileFromThreshold(t));
                }
            } catch (e) {
                console.warn("[RiskProfileSelector] load failed", e);
            } finally {
                if (!abort) {
                    setLoading(false);
                    setHydrated(true);
                }
            }
        })();
        return () => {
            abort = true;
        };
    }, [wallet]);

    const persist = async (next: { autoApproveBelowUsd: number; requireMultisigAboveUsd?: number; dailyValueCapUsd?: number }) => {
        if (!wallet) {
            toast.error("Connect a wallet to save agent guardrails");
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/dacs/policy", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ walletAddress: wallet, ...next }),
            });
            const json = await res.json();
            if (!json?.ok) throw new Error(json?.error || "save_failed");
        } catch (e: any) {
            console.error("[RiskProfileSelector] save failed", e);
            toast.error("Could not save agent guardrails");
        } finally {
            setSaving(false);
        }
    };

    const handleProfileChange = async (profile: RiskProfile) => {
        const p = PROFILES[profile];
        setSelectedProfile(profile);
        setCustomThreshold(p.autoApproveBelowUsd);
        await persist({
            autoApproveBelowUsd: p.autoApproveBelowUsd,
            requireMultisigAboveUsd: p.requireMultisigAboveUsd,
            dailyValueCapUsd: p.dailyValueCapUsd,
        });
        toast.success(`Risk profile set to ${p.name}`);
    };

    const handleThresholdChange = (value: number) => {
        setCustomThreshold(value);
    };

    const handleThresholdCommit = async (value: number) => {
        const inferred = inferProfileFromThreshold(value);
        setSelectedProfile(inferred);
        const p = PROFILES[inferred];
        await persist({
            autoApproveBelowUsd: value,
            requireMultisigAboveUsd: p.requireMultisigAboveUsd,
            dailyValueCapUsd: p.dailyValueCapUsd,
        });
    };

    return (
        <div className="space-y-6">
            {!wallet && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] uppercase tracking-widest font-black text-amber-700 dark:text-amber-400">
                    Connect a wallet to enforce these guardrails on the agent loop.
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(Object.keys(PROFILES) as RiskProfile[]).map((key) => {
                    const profile = PROFILES[key];
                    const isSelected = selectedProfile === key;
                    const Icon = profile.icon;

                    return (
                        <button
                            key={key}
                            onClick={() => handleProfileChange(key)}
                            disabled={!wallet || saving || loading}
                            className={`relative p-4 rounded-xl border text-left transition-all duration-300 group shadow-sm disabled:opacity-60 disabled:cursor-not-allowed
                                ${isSelected ? `${profile.bg} ${profile.border} ring-1 ring-inset ring-primary/20` : "bg-muted/30 border-border hover:bg-primary/5"}
                            `}
                        >
                            <div className="flex justify-between items-start mb-3">
                                <div className={`p-2 rounded-lg ${isSelected ? "bg-background/50" : "bg-muted group-hover:bg-muted/80"}`}>
                                    <Icon className={isSelected ? profile.color : "text-muted-foreground"} size={20} />
                                </div>
                                {isSelected && (
                                    <div className={`w-2 h-2 rounded-full ${profile.color.replace('text', 'bg')} animate-pulse shadow-[0_0_8px_var(--dashboard-accent-muted)]`} />
                                )}
                            </div>
                            <h3 className={`font-black mb-1 uppercase tracking-tight ${isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>
                                {profile.name}
                            </h3>
                            <p className="text-[10px] text-muted-foreground leading-relaxed font-black uppercase tracking-widest">
                                {profile.description}
                            </p>
                            <p className="mt-2 text-[9px] font-mono text-muted-foreground">
                                auto ≤ ${profile.autoApproveBelowUsd.toLocaleString()} · multisig &gt; ${profile.requireMultisigAboveUsd.toLocaleString()}
                            </p>
                        </button>
                    );
                })}
            </div>

            <div className="rounded-xl bg-muted/10 border border-border p-6 animate-in fade-in slide-in-from-top-4 duration-500 shadow-inner">
                <div className="flex items-center justify-between gap-2 mb-4">
                    <div className="flex items-center gap-2">
                        <Lock className="text-primary" size={16} />
                        <h3 className="font-black text-foreground text-xs uppercase tracking-widest">Auto-Sign Threshold</h3>
                    </div>
                    {(saving || loading) && (
                        <span className="text-[9px] uppercase tracking-widest font-black text-muted-foreground">
                            {saving ? "Saving…" : "Loading…"}
                        </span>
                    )}
                </div>

                <div className="space-y-4">
                    <div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-2 uppercase font-black tracking-widest">
                            <span>Notional cap</span>
                            <span className="text-foreground font-mono font-black">${customThreshold.toLocaleString()}</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="5000"
                            step="50"
                            value={customThreshold}
                            disabled={!wallet || !hydrated}
                            onChange={(e) => handleThresholdChange(Number(e.target.value))}
                            onMouseUp={(e) => handleThresholdCommit(Number((e.target as HTMLInputElement).value))}
                            onTouchEnd={(e) => handleThresholdCommit(Number((e.target as HTMLInputElement).value))}
                            onKeyUp={(e) => handleThresholdCommit(Number((e.target as HTMLInputElement).value))}
                            className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer disabled:opacity-50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-[0_0_8px_var(--dashboard-accent-muted)] [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-125"
                        />
                        <p className="text-[9px] text-muted-foreground mt-2 italic font-black uppercase tracking-widest">
                            Transactions below <strong className="text-foreground">${customThreshold.toLocaleString()}</strong> are auto-signed by the agent loop. Larger amounts require multisig approval. Enforced server-side on every command via DACS router.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
