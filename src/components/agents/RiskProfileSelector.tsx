"use client";

import React, { useEffect, useState } from "react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { toast } from "@/lib/toast-notifications";
import { useWallet } from "@/lib/wallet/compat";

type RiskProfile = "conservative" | "balanced" | "aggressive";

// Wording deliberately mirrors /app/onboarding RiskStep so the user sees
// the same three profiles in both flows.
const PROFILES: Record<
    RiskProfile,
    {
        id: RiskProfile;
        label: string;
        tagline: string;
        amplitude: number;
        dense: boolean;
        cap: string;
        autoApproveBelowUsd: number;
        requireMultisigAboveUsd: number;
        dailyValueCapUsd: number;
        allocation: { stables: number; majors: number; defi: number };
    }
> = {
    conservative: {
        id: "conservative",
        label: "Conservative",
        tagline: "Capital preservation. Stables-led. Tight agent leash.",
        amplitude: 4,
        dense: false,
        cap: "Drawdown cap · 2%",
        autoApproveBelowUsd: 100,
        requireMultisigAboveUsd: 1_000,
        dailyValueCapUsd: 5_000,
        allocation: { stables: 75, majors: 20, defi: 5 },
    },
    balanced: {
        id: "balanced",
        label: "Balanced",
        tagline: "Yield-aware. Auto-DCA. Standard agent authority.",
        amplitude: 9,
        dense: false,
        cap: "Drawdown cap · 8%",
        autoApproveBelowUsd: 500,
        requireMultisigAboveUsd: 10_000,
        dailyValueCapUsd: 25_000,
        allocation: { stables: 45, majors: 40, defi: 15 },
    },
    aggressive: {
        id: "aggressive",
        label: "Aggressive",
        tagline: "High-yield, full agent autonomy, advanced strategies.",
        amplitude: 16,
        dense: true,
        cap: "Drawdown cap · 25%",
        autoApproveBelowUsd: 2_000,
        requireMultisigAboveUsd: 50_000,
        dailyValueCapUsd: 100_000,
        allocation: { stables: 20, majors: 40, defi: 40 },
    },
};

function inferProfileFromThreshold(t: number): RiskProfile {
    if (t <= 200) return "conservative";
    if (t <= 1_000) return "balanced";
    return "aggressive";
}

const RiskWave = ({ amplitude, dense }: { amplitude: number; dense: boolean }) => {
    const points = Array.from({ length: 32 }).map((_, i) => {
        const x = (i / 31) * 100;
        const seed = Math.sin(i * 0.65 + amplitude) * Math.cos(i * 0.31);
        const y = 30 - seed * amplitude * (dense ? 1.2 : 1);
        return `${x},${y}`;
    });
    return (
        <svg viewBox="0 0 100 60" className="w-full h-12" preserveAspectRatio="none">
            <polyline
                points={points.join(" ")}
                fill="none"
                stroke="#7c3aed"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <line x1="0" y1="30" x2="100" y2="30" stroke="#7c3aed" strokeWidth="0.4" opacity="0.3" strokeDasharray="2 3" />
        </svg>
    );
};

const AllocBar = ({ a }: { a: { stables: number; majors: number; defi: number } }) => (
    <div className="space-y-2">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-violet-50">
            <div className="h-full bg-violet-200" style={{ width: `${a.stables}%` }} />
            <div className="h-full bg-violet-400" style={{ width: `${a.majors}%` }} />
            <div className="h-full bg-violet-600" style={{ width: `${a.defi}%` }} />
        </div>
        <div className="flex items-center gap-3 text-[9px] tracking-[0.16em] uppercase font-semibold text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-sm bg-violet-200" />Stables {a.stables}</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-sm bg-violet-400" />Majors {a.majors}</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-sm bg-violet-600" />DeFi {a.defi}</span>
        </div>
    </div>
);

export const RiskProfileSelector = () => {
    const { publicKey } = useWallet();
    const wallet = publicKey?.toBase58() ?? null;

    const [selectedProfile, setSelectedProfile] = useState<RiskProfile>("balanced");
    const [customThreshold, setCustomThreshold] = useState<number>(PROFILES.balanced.autoApproveBelowUsd);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [hydrated, setHydrated] = useState(false);

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
        toast.success(`Profile set to ${p.label}`);
    };

    const handleThresholdChange = (value: number) => setCustomThreshold(value);

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
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[12px] text-amber-800">
                    Connect a wallet to enforce these guardrails on the agent loop.
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(Object.keys(PROFILES) as RiskProfile[]).map((key) => {
                    const profile = PROFILES[key];
                    const isSelected = selectedProfile === key;
                    return (
                        <button
                            key={key}
                            onClick={() => handleProfileChange(key)}
                            disabled={!wallet || saving || loading}
                            className={`group relative text-left rounded-2xl border bg-white p-5 transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                                isSelected
                                    ? "border-violet-600 ring-1 ring-violet-600"
                                    : "border-violet-100 hover:border-violet-300"
                            }`}
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-slate-400">Profile</p>
                                    <p className="mt-1 text-[15px] font-semibold text-slate-900">{profile.label}</p>
                                </div>
                                <span
                                    className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                                        isSelected ? "border-violet-600 bg-violet-600" : "border-violet-200 bg-white"
                                    }`}
                                >
                                    {isSelected && <DreyvStar size={10} className="text-white" />}
                                </span>
                            </div>

                            <RiskWave amplitude={profile.amplitude} dense={profile.dense} />

                            <p className="mt-4 text-[12px] text-slate-500 leading-relaxed h-10">{profile.tagline}</p>

                            <div className="mt-4">
                                <AllocBar a={profile.allocation} />
                            </div>

                            <div className="mt-4 pt-3 border-t border-violet-100 flex items-center justify-between">
                                <span className="text-[10px] tracking-[0.18em] uppercase font-semibold text-slate-500">{profile.cap}</span>
                                <span className="text-[10px] font-medium text-slate-400">
                                    auto ≤ ${profile.autoApproveBelowUsd.toLocaleString()}
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="rounded-2xl border border-violet-100 bg-white p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <p className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Auto-sign threshold</p>
                        <p className="mt-1 text-[15px] font-semibold text-slate-900">Notional cap per transaction</p>
                    </div>
                    <span className="text-[20px] font-semibold text-slate-900 tabular-nums">${customThreshold.toLocaleString()}</span>
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
                    className="w-full h-1.5 bg-violet-100 rounded-full appearance-none cursor-pointer disabled:opacity-50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-600 [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110"
                />
                <p className="mt-3 text-[12px] text-slate-500 leading-relaxed">
                    Transactions below <span className="font-semibold text-slate-900">${customThreshold.toLocaleString()}</span> are auto-signed by the agent loop. Larger amounts require multisig approval. Enforced server-side on every command.
                </p>
                {(saving || loading) && (
                    <p className="mt-2 text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-600">
                        {saving ? "Saving…" : "Loading…"}
                    </p>
                )}
            </div>
        </div>
    );
};
