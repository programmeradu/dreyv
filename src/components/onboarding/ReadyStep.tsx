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

interface ReadyStepProps extends StepProps {
    onComplete: () => void;
    completing: boolean;
}

export const ReadyStep = ({ data, onComplete, completing }: ReadyStepProps) => {
    const wallet = data.walletAddress
        ? `${data.walletAddress.slice(0, 6)}…${data.walletAddress.slice(-6)}`
        : "Not linked";

    const summary = [
        { k: "Identity", v: data.displayName || "Unnamed signer" },
        { k: "Organization", v: data.organizationName || "Personal" },
        { k: "Vault", v: wallet, mono: true },
        { k: "Risk posture", v: data.riskProfile.charAt(0).toUpperCase() + data.riskProfile.slice(1) },
        { k: "Co-signers", v: data.teamEmails.length > 0 ? `${data.teamEmails.length} queued` : "Solo" },
        { k: "Email", v: data.email || "Not set" },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2.5">
                <DreyvStar size={12} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Step 06 · Launch</span>
            </div>

            <div className="space-y-3 max-w-xl">
                <h2 className="text-[26px] sm:text-[32px] lg:text-[36px] leading-[1.1] font-semibold tracking-[-0.02em] text-slate-900">
                    Everything looks <span className="italic font-light text-violet-600">ready</span>.
                </h2>
                <p className="text-[14px] text-slate-500 leading-relaxed">
                    Review your setup. You can change anything later from Settings.
                </p>
            </div>

            {/* Receipt-style summary */}
            <div className="rounded-3xl border border-violet-100 bg-white overflow-hidden">
                <div className="px-6 py-4 flex items-center justify-between border-b border-violet-100 bg-violet-50/40">
                    <div className="flex items-center gap-2.5">
                        <DreyvStar size={14} className="text-violet-600" />
                        <p className="text-[11px] tracking-[0.22em] uppercase font-semibold text-slate-700">Setup manifest</p>
                    </div>
                    <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Verified</p>
                </div>
                <dl className="divide-y divide-violet-100">
                    {summary.map((row, i) => (
                        <div key={row.k} className="flex items-center px-6 py-3.5">
                            <span className="text-[9px] tabular-nums font-semibold tracking-widest text-slate-400 w-8">
                                0{i + 1}
                            </span>
                            <dt className="flex-1 text-[11px] tracking-[0.2em] uppercase font-semibold text-slate-500">
                                {row.k}
                            </dt>
                            <dd
                                className={`text-[13px] font-semibold text-slate-900 text-right max-w-[55%] truncate ${
                                    row.mono ? "font-mono text-[12px]" : ""
                                }`}
                            >
                                {row.v}
                            </dd>
                        </div>
                    ))}
                </dl>
                <div className="px-6 py-4 bg-violet-50/30 border-t border-violet-100 flex items-center justify-between text-[10px] tracking-[0.18em] uppercase font-semibold">
                    <span className="text-slate-500">Custody</span>
                    <span className="text-violet-700">Non-custodial · keys never leave your wallet</span>
                </div>
            </div>

            {/* Launch */}
            <div className="flex items-center gap-5">
                <button
                    onClick={onComplete}
                    disabled={completing}
                    className="group inline-flex items-center gap-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-[13px] font-semibold tracking-[0.16em] uppercase px-7 py-3.5 transition-colors"
                >
                    {completing ? (
                        <>
                            <DreyvStar size={14} className="text-white animate-spin" />
                            Launching…
                        </>
                    ) : (
                        <>
                            Launch Dreyv
                            <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                        </>
                    )}
                </button>
                <span className="text-[11px] text-slate-400 tracking-wide">Opens your treasury workspace</span>
            </div>
        </div>
    );
};
