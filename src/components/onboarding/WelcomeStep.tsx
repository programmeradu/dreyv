"use client";

import React from "react";
import type { OnboardingData } from "@/app/app/onboarding/page";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface StepProps {
    data: OnboardingData;
    updateData: (updates: Partial<OnboardingData>) => void;
    onNext: () => void;
    onBack: () => void;
}

/**
 * Bespoke pillar visuals — each is a unique micro-illustration in solid
 * violet on white, designed specifically for the Dreyv onboarding pillars.
 * No stock iconography.
 */

const PillarCustody = () => (
    <svg viewBox="0 0 88 88" className="w-full h-full">
        <defs>
            <pattern id="pcg" width="6" height="6" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.6" fill="#7c3aed" opacity="0.18" />
            </pattern>
        </defs>
        <rect x="6" y="6" width="76" height="76" rx="20" fill="url(#pcg)" />
        {/* Vault door circle */}
        <circle cx="44" cy="44" r="22" stroke="#7c3aed" strokeWidth="1.4" fill="white" />
        <circle cx="44" cy="44" r="14" stroke="#7c3aed" strokeWidth="1" fill="none" opacity="0.5" />
        {/* Tumbler spokes */}
        {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * Math.PI) / 4;
            const x1 = 44 + Math.cos(a) * 22;
            const y1 = 44 + Math.sin(a) * 22;
            const x2 = 44 + Math.cos(a) * 26;
            const y2 = 44 + Math.sin(a) * 26;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7c3aed" strokeWidth="1.4" strokeLinecap="round" />;
        })}
        {/* Center key */}
        <circle cx="44" cy="44" r="4" fill="#7c3aed" />
        <rect x="43.2" y="44" width="1.6" height="9" fill="#7c3aed" />
        <rect x="44.8" y="50" width="3" height="1.4" fill="#7c3aed" />
    </svg>
);

const PillarAgents = () => (
    <svg viewBox="0 0 88 88" className="w-full h-full">
        <rect x="6" y="6" width="76" height="76" rx="20" fill="#f5f3ff" />
        {/* Network nodes */}
        {[
            [44, 22], [22, 44], [66, 44], [44, 66], [44, 44],
        ].map(([x, y], i) => (
            <g key={i}>
                <circle cx={x} cy={y} r={i === 4 ? 6 : 3.5} fill={i === 4 ? "#7c3aed" : "white"} stroke="#7c3aed" strokeWidth="1.3" />
            </g>
        ))}
        {/* Edges */}
        {[
            [44, 22, 44, 44], [22, 44, 44, 44], [66, 44, 44, 44], [44, 66, 44, 44],
            [44, 22, 22, 44], [44, 22, 66, 44], [22, 44, 44, 66], [66, 44, 44, 66],
        ].map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7c3aed" strokeWidth="0.9" opacity="0.5" />
        ))}
        {/* Corner ticks */}
        {[[10, 10], [78, 10], [10, 78], [78, 78]].map(([x, y], i) => (
            <g key={i} stroke="#7c3aed" strokeWidth="1">
                <line x1={x - 3} y1={y} x2={x + 3} y2={y} />
                <line x1={x} y1={y - 3} x2={x} y2={y + 3} />
            </g>
        ))}
    </svg>
);

const PillarMultisig = () => (
    <svg viewBox="0 0 88 88" className="w-full h-full">
        <rect x="6" y="6" width="76" height="76" rx="20" fill="white" stroke="#ddd6fe" strokeWidth="1" />
        {/* Three signers as overlapping rounded squares */}
        <g>
            <rect x="18" y="30" width="22" height="28" rx="6" fill="white" stroke="#7c3aed" strokeWidth="1.3" />
            <rect x="33" y="24" width="22" height="34" rx="6" fill="white" stroke="#7c3aed" strokeWidth="1.5" />
            <rect x="48" y="30" width="22" height="28" rx="6" fill="white" stroke="#7c3aed" strokeWidth="1.3" />
        </g>
        {/* Avatars */}
        <circle cx="29" cy="40" r="3.5" fill="#7c3aed" />
        <circle cx="44" cy="36" r="4" fill="#7c3aed" />
        <circle cx="59" cy="40" r="3.5" fill="#7c3aed" />
        {/* Signature lines */}
        <line x1="22" y1="50" x2="36" y2="50" stroke="#7c3aed" strokeWidth="1" opacity="0.4" />
        <line x1="36" y1="46" x2="52" y2="46" stroke="#7c3aed" strokeWidth="1" opacity="0.4" />
        <line x1="36" y1="50" x2="52" y2="50" stroke="#7c3aed" strokeWidth="1" opacity="0.4" />
        <line x1="52" y1="50" x2="66" y2="50" stroke="#7c3aed" strokeWidth="1" opacity="0.4" />
        {/* k-of-n badge */}
        <circle cx="68" cy="22" r="9" fill="#7c3aed" />
        <text x="68" y="25.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="white" fontFamily="ui-monospace, monospace">2/3</text>
    </svg>
);

const PILLARS = [
    { title: "Self-custody", caption: "Non-custodial · multisig native", Visual: PillarCustody },
    { title: "Studio agents", caption: "Build, simulate, automate", Visual: PillarAgents },
    { title: "Signer-ready", caption: "Squads, Phantom, Ledger", Visual: PillarMultisig },
];

export const WelcomeStep = ({ onNext }: StepProps) => {
    return (
        <div className="space-y-7">
            {/* Eyebrow */}
            <div className="flex items-center gap-2">
                <DreyvStar size={11} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.22em] uppercase font-semibold text-violet-700">Step 01 · Welcome</span>
            </div>

            {/* Hero */}
            <div className="space-y-3 max-w-xl">
                <h1 className="text-[28px] sm:text-[34px] lg:text-[40px] leading-[1.05] font-semibold tracking-[-0.02em] text-slate-900">
                    Treasury, in <span className="italic font-light text-violet-600">plain</span> language.
                </h1>
                <p className="text-[13px] sm:text-[14px] leading-relaxed text-slate-500 max-w-lg">
                    Five quick steps. You stay in custody the whole way — Dreyv handles intent, simulation
                    and signatures, never your keys.
                </p>
            </div>

            {/* Pillars */}
            <div className="grid grid-cols-3 gap-3">
                {PILLARS.map((p) => (
                    <div
                        key={p.title}
                        className="group rounded-xl border border-violet-100 bg-white p-3 sm:p-4 hover:border-violet-300 transition-colors"
                    >
                        <div className="aspect-square w-full max-w-[88px] mx-auto">
                            <p.Visual />
                        </div>
                        <p className="mt-2.5 text-[12px] font-semibold text-slate-900 tracking-tight">{p.title}</p>
                        <p className="mt-0.5 text-[10px] sm:text-[11px] text-slate-500 leading-relaxed">{p.caption}</p>
                    </div>
                ))}
            </div>

            {/* CTA */}
            <div className="flex items-center gap-4 pt-1">
                <button
                    onClick={onNext}
                    className="group inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold tracking-[0.14em] uppercase px-5 py-3 transition-colors"
                >
                    Begin setup
                    <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                </button>
                <span className="text-[10px] text-slate-400 tracking-wide">≈ 90 seconds</span>
            </div>
        </div>
    );
};
