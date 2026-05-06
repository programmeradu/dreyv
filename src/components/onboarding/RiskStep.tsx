"use client";

import React from "react";
import { DreyvStar } from "@/components/studio/DreyvStar";
import type { OnboardingData } from "@/app/app/onboarding/page";

interface StepProps {
    data: OnboardingData;
    updateData: (updates: Partial<OnboardingData>) => void;
    onNext: () => void;
    onBack: () => void;
}

type RiskId = OnboardingData["riskProfile"];

// Mini exposure waveform per profile — bespoke SVG, not a chart library.
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

const RISK: { id: RiskId; label: string; tagline: string; allocation: { stables: number; majors: number; defi: number }; amplitude: number; dense: boolean; cap: string }[] = [
    {
        id: "conservative",
        label: "Conservative",
        tagline: "Capital preservation. Stables-led. Tight agent leash.",
        allocation: { stables: 75, majors: 20, defi: 5 },
        amplitude: 4,
        dense: false,
        cap: "Drawdown cap · 2%",
    },
    {
        id: "moderate",
        label: "Balanced",
        tagline: "Yield-aware. Auto-DCA. Standard agent authority.",
        allocation: { stables: 45, majors: 40, defi: 15 },
        amplitude: 9,
        dense: false,
        cap: "Drawdown cap · 8%",
    },
    {
        id: "aggressive",
        label: "Aggressive",
        tagline: "High-yield, full agent autonomy, advanced strategies.",
        allocation: { stables: 20, majors: 40, defi: 40 },
        amplitude: 16,
        dense: true,
        cap: "Drawdown cap · 25%",
    },
];

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

export const RiskStep = ({ data, updateData }: StepProps) => {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2.5">
                <DreyvStar size={12} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Step 04 · Posture</span>
            </div>

            <div className="space-y-3 max-w-xl">
                <h2 className="text-[26px] sm:text-[32px] lg:text-[36px] leading-[1.1] font-semibold tracking-[-0.02em] text-slate-900">
                    How should the agent <span className="italic font-light text-violet-600">behave</span>?
                </h2>
                <p className="text-[14px] text-slate-500 leading-relaxed">
                    Sets default guardrails for autonomous actions. Tweak any time from Agent Settings.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {RISK.map((r) => {
                    const selected = data.riskProfile === r.id;
                    return (
                        <button
                            key={r.id}
                            onClick={() => updateData({ riskProfile: r.id })}
                            className={`group relative text-left rounded-2xl border bg-white p-5 transition-all ${
                                selected
                                    ? "border-violet-600 ring-1 ring-violet-600"
                                    : "border-violet-100 hover:border-violet-300"
                            }`}
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-slate-400">Profile</p>
                                    <p className="mt-1 text-[15px] font-semibold text-slate-900">{r.label}</p>
                                </div>
                                <span
                                    className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                                        selected ? "border-violet-600 bg-violet-600" : "border-violet-200 bg-white"
                                    }`}
                                >
                                    {selected && <DreyvStar size={10} className="text-white" />}
                                </span>
                            </div>

                            <RiskWave amplitude={r.amplitude} dense={r.dense} />

                            <p className="mt-4 text-[12px] text-slate-500 leading-relaxed h-10">{r.tagline}</p>

                            <div className="mt-4">
                                <AllocBar a={r.allocation} />
                            </div>

                            <div className="mt-4 pt-3 border-t border-violet-100 text-[10px] tracking-[0.18em] uppercase font-semibold text-slate-500">
                                {r.cap}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
