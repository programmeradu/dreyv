"use client";

import React, { useEffect } from "react";
import { useWallet, useWalletModal } from "@/lib/wallet/compat";
import { DreyvStar } from "@/components/studio/DreyvStar";
import type { OnboardingData } from "@/app/app/onboarding/page";

interface StepProps {
    data: OnboardingData;
    updateData: (updates: Partial<OnboardingData>) => void;
    onNext: () => void;
    onBack: () => void;
}

// Bespoke vault graphic — concentric vault dial, no stock wallet icons.
const VaultDial = ({ active }: { active: boolean }) => (
    <svg viewBox="0 0 200 200" className="w-full h-full">
        <defs>
            <pattern id="dialGrid" width="8" height="8" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.6" fill="#7c3aed" opacity={active ? 0.25 : 0.12} />
            </pattern>
        </defs>
        <rect x="0" y="0" width="200" height="200" fill="url(#dialGrid)" rx="24" />
        <circle cx="100" cy="100" r="68" fill="white" stroke="#7c3aed" strokeWidth="1.5" />
        <circle cx="100" cy="100" r="52" fill="none" stroke="#7c3aed" strokeWidth="1" opacity="0.45" />
        <circle cx="100" cy="100" r="36" fill="none" stroke="#7c3aed" strokeWidth="1" opacity="0.3" />
        {/* Tumbler ticks */}
        {Array.from({ length: 24 }).map((_, i) => {
            const a = (i * Math.PI) / 12;
            const x1 = 100 + Math.cos(a) * 68;
            const y1 = 100 + Math.sin(a) * 68;
            const len = i % 6 === 0 ? 10 : 5;
            const x2 = 100 + Math.cos(a) * (68 + len);
            const y2 = 100 + Math.sin(a) * (68 + len);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7c3aed" strokeWidth={i % 6 === 0 ? 1.4 : 0.8} strokeLinecap="round" />;
        })}
        {/* Center indicator */}
        <circle cx="100" cy="100" r={active ? 10 : 6} fill="#7c3aed" />
        {active && (
            <>
                <circle cx="100" cy="100" r="14" fill="none" stroke="#7c3aed" strokeWidth="1" opacity="0.4">
                    <animate attributeName="r" from="14" to="56" dur="2.4s" repeatCount="indefinite" />
                    <animate attributeName="opacity" from="0.4" to="0" dur="2.4s" repeatCount="indefinite" />
                </circle>
            </>
        )}
        {/* Status dot */}
        <circle cx="156" cy="44" r="5" fill={active ? "#7c3aed" : "#e2e8f0"} />
    </svg>
);

export const VaultStep = ({ updateData }: StepProps) => {
    const { publicKey, connected } = useWallet();
    const { setVisible: openWalletModal } = useWalletModal();

    useEffect(() => {
        if (connected && publicKey) updateData({ walletAddress: publicKey.toBase58() });
        else updateData({ walletAddress: "" });
    }, [connected, publicKey, updateData]);

    const addr = publicKey?.toBase58();
    const short = addr ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : null;

    return (
        <div className="space-y-10">
            <div className="flex items-center gap-2.5">
                <DreyvStar size={12} className="text-violet-600" />
                <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Step 03 · Custody</span>
            </div>

            <div className="space-y-3 max-w-xl">
                <h2 className="text-[34px] sm:text-[42px] leading-[1.05] font-semibold tracking-[-0.02em] text-slate-900">
                    Connect your <span className="italic font-light text-violet-600">vault</span>.
                </h2>
                <p className="text-[14px] text-slate-500 leading-relaxed">
                    Squads multisig, Phantom, Ledger or any Solana wallet. Read-only is fine — Dreyv never
                    touches keys.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-8 items-stretch">
                <div className="rounded-3xl border border-violet-100 bg-white p-7">
                    <div className="flex items-center justify-between mb-5">
                        <div>
                            <p className="text-[10px] tracking-[0.22em] uppercase font-semibold text-slate-500">Status</p>
                            <p className="mt-1 text-[16px] font-semibold text-slate-900">
                                {connected ? "Vault linked" : "Awaiting connection"}
                            </p>
                        </div>
                        <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] tracking-[0.18em] uppercase font-semibold ${
                                connected
                                    ? "border-violet-200 bg-violet-50 text-violet-700"
                                    : "border-slate-200 bg-slate-50 text-slate-500"
                            }`}
                        >
                            <DreyvStar size={9} />
                            {connected ? "Live" : "Idle"}
                        </span>
                    </div>

                    {connected && short ? (
                        <div className="space-y-4">
                            <div className="rounded-2xl border border-violet-100 bg-violet-50/40 px-4 py-3 font-mono text-[12px] text-slate-700 tabular-nums break-all">
                                {addr}
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                {[
                                    { k: "Network", v: "Solana" },
                                    { k: "Mode", v: "Non-custodial" },
                                    { k: "Signer", v: short },
                                ].map((it) => (
                                    <div key={it.k} className="rounded-xl border border-violet-100 bg-white py-2.5 px-2">
                                        <p className="text-[9px] tracking-[0.2em] uppercase text-slate-400">{it.k}</p>
                                        <p className="mt-1 text-[11px] font-semibold text-slate-900 truncate font-mono">{it.v}</p>
                                    </div>
                                ))}
                            </div>
                            <a
                                href={`https://solscan.io/account/${addr}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.16em] uppercase font-semibold text-violet-700 hover:text-violet-900"
                            >
                                Inspect on Solscan →
                            </a>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            <p className="text-[13px] text-slate-500 leading-relaxed">
                                Connecting unlocks treasury intent, simulation and one-click signer requests.
                                Skip if you're just exploring — you can link later from Settings.
                            </p>
                            <button
                                onClick={() => openWalletModal(true)}
                                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold tracking-[0.16em] uppercase px-6 py-3 transition-colors"
                            >
                                Connect wallet →
                            </button>
                        </div>
                    )}
                </div>

                {/* Vault dial visual */}
                <div className="rounded-3xl border border-violet-100 bg-violet-50/40 p-5 flex items-center justify-center">
                    <div className="w-full max-w-[200px]">
                        <VaultDial active={connected} />
                    </div>
                </div>
            </div>
        </div>
    );
};
