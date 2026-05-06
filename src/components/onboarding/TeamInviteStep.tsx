"use client";

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { DreyvStar } from "@/components/studio/DreyvStar";
import type { OnboardingData } from "@/app/app/onboarding/page";

interface StepProps {
    data: OnboardingData;
    updateData: (updates: Partial<OnboardingData>) => void;
    onNext: () => void;
    onBack: () => void;
}

const isWallet = (v: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);

export const TeamInviteStep = ({ data, updateData }: StepProps) => {
    const [val, setVal] = useState("");

    const add = () => {
        const v = val.trim();
        if (!v || data.teamEmails.includes(v)) return;
        updateData({ teamEmails: [...data.teamEmails, v] });
        setVal("");
    };
    const remove = (x: string) => updateData({ teamEmails: data.teamEmails.filter((e) => e !== x) });

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2.5">
                <DreyvStar size={12} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Step 05 · Co-signers</span>
            </div>

            <div className="space-y-3 max-w-xl">
                <h2 className="text-[26px] sm:text-[32px] lg:text-[36px] leading-[1.1] font-semibold tracking-[-0.02em] text-slate-900">
                    Invite your <span className="italic font-light text-violet-600">circle</span>.
                </h2>
                <p className="text-[14px] text-slate-500 leading-relaxed">
                    Add co-signers, treasurers or read-only observers. Email or wallet address — both work.
                </p>
            </div>

            <div className="rounded-3xl border border-violet-100 bg-white p-6 sm:p-7 space-y-6">
                {/* Composer */}
                <div className="flex flex-col sm:flex-row gap-2.5">
                    <Input
                        value={val}
                        onChange={(e) => setVal(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
                        placeholder="alice@dreyv.com   ·   GoyX…Frsg"
                        className="h-12 rounded-xl border-violet-100 bg-white text-[14px] focus-visible:ring-violet-300 font-mono"
                    />
                    <button
                        onClick={add}
                        disabled={!val.trim()}
                        className="rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-[12px] font-semibold tracking-[0.16em] uppercase px-6 py-3 transition-colors whitespace-nowrap"
                    >
                        Queue invite
                    </button>
                </div>

                {/* Roster */}
                {data.teamEmails.length > 0 ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] tracking-[0.22em] uppercase font-semibold text-slate-500">
                                {data.teamEmails.length} queued
                            </p>
                            <p className="text-[10px] tracking-[0.18em] uppercase font-semibold text-violet-600">
                                Sent on launch
                            </p>
                        </div>
                        <ul className="divide-y divide-violet-100 rounded-2xl border border-violet-100 overflow-hidden">
                            {data.teamEmails.map((e, i) => {
                                const wallet = isWallet(e);
                                return (
                                    <li key={e} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-violet-50/40 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className="text-[10px] tabular-nums font-semibold tracking-widest text-slate-400 w-5">
                                                0{i + 1}
                                            </span>
                                            <span
                                                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] tracking-[0.18em] uppercase font-semibold ${
                                                    wallet
                                                        ? "border-violet-200 bg-violet-50 text-violet-700"
                                                        : "border-slate-200 bg-slate-50 text-slate-600"
                                                }`}
                                            >
                                                {wallet ? "Wallet" : "Email"}
                                            </span>
                                            <span className={`truncate text-[12px] ${wallet ? "font-mono" : ""} text-slate-700`}>
                                                {e}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => remove(e)}
                                            className="text-[10px] tracking-[0.18em] uppercase font-semibold text-slate-400 hover:text-violet-700 transition-colors"
                                        >
                                            Remove
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/30 p-8 text-center">
                        <DreyvStar size={20} className="text-violet-400 mx-auto" />
                        <p className="mt-3 text-[12px] font-semibold tracking-[0.18em] uppercase text-slate-700">Solo for now</p>
                        <p className="mt-1.5 text-[11px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                            You can invite co-signers any time from the Team page. Skipping is fine.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};
