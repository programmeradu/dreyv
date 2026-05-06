"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { DreyvStar } from "@/components/studio/DreyvStar";
import type { OnboardingData } from "@/app/app/onboarding/page";

interface StepProps {
    data: OnboardingData;
    updateData: (updates: Partial<OnboardingData>) => void;
    onNext: () => void;
    onBack: () => void;
}

const Field = ({
    label,
    hint,
    children,
    optional,
}: {
    label: string;
    hint?: string;
    optional?: boolean;
    children: React.ReactNode;
}) => (
    <label className="block group">
        <div className="flex items-baseline justify-between mb-2">
            <span className="text-[10px] tracking-[0.2em] uppercase font-semibold text-slate-700">{label}</span>
            {optional && <span className="text-[9px] tracking-widest uppercase text-slate-400">Optional</span>}
        </div>
        {children}
        {hint && <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">{hint}</p>}
    </label>
);

export const ProfileStep = ({ data, updateData }: StepProps) => {
    const randomize = () => updateData({ avatarSeed: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` });

    return (
        <div className="space-y-10">
            <div className="flex items-center gap-2.5">
                <DreyvStar size={12} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Step 02 · Identity</span>
            </div>

            <div className="space-y-3 max-w-xl">
                <h2 className="text-[34px] sm:text-[42px] leading-[1.05] font-semibold tracking-[-0.02em] text-slate-900">
                    How should your team <span className="italic font-light text-violet-600">see you</span>?
                </h2>
                <p className="text-[14px] text-slate-500 leading-relaxed">
                    Used across signer requests, alerts and shared reports.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-10 items-start">
                {/* Avatar tile */}
                <div className="space-y-3">
                    <div className="relative aspect-square rounded-3xl border border-violet-100 bg-violet-50/40 p-3">
                        <div className="absolute inset-3 rounded-2xl bg-white border border-violet-100 overflow-hidden">
                            <img
                                src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${data.avatarSeed}&backgroundColor=ede9fe`}
                                alt="Avatar preview"
                                className="w-full h-full object-cover"
                            />
                        </div>
                        <div className="absolute -bottom-2 -right-2 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
                            <DreyvStar size={14} />
                        </div>
                    </div>
                    <button
                        onClick={randomize}
                        className="w-full rounded-xl border border-violet-100 bg-white hover:bg-violet-50 text-[11px] font-semibold tracking-[0.18em] uppercase text-slate-700 hover:text-violet-700 py-2.5 transition-colors"
                    >
                        Reroll avatar
                    </button>
                </div>

                {/* Fields */}
                <div className="space-y-6">
                    <Field label="Display name">
                        <Input
                            value={data.displayName}
                            onChange={(e) => updateData({ displayName: e.target.value })}
                            placeholder="Sam Adu"
                            className="h-12 rounded-xl border-violet-100 bg-white text-[14px] focus-visible:ring-violet-300"
                        />
                    </Field>

                    <Field label="Email" optional hint="For team invites, alerts and weekly digest.">
                        <Input
                            type="email"
                            value={data.email || ""}
                            onChange={(e) => updateData({ email: e.target.value })}
                            placeholder="you@dreyv.com"
                            className="h-12 rounded-xl border-violet-100 bg-white text-[14px] focus-visible:ring-violet-300"
                        />
                    </Field>

                    <Field label="Organization" optional hint="DAO, fund, studio — personalises your workspace.">
                        <Input
                            value={data.organizationName}
                            onChange={(e) => updateData({ organizationName: e.target.value })}
                            placeholder="StaUniverse"
                            className="h-12 rounded-xl border-violet-100 bg-white text-[14px] focus-visible:ring-violet-300"
                        />
                    </Field>
                </div>
            </div>
        </div>
    );
};
