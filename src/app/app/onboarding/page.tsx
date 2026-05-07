"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/hooks/useProfile";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { ProfileStep } from "@/components/onboarding/ProfileStep";
import { VaultStep } from "@/components/onboarding/VaultStep";
import { RiskStep } from "@/components/onboarding/RiskStep";
import { TeamInviteStep } from "@/components/onboarding/TeamInviteStep";
import { ReadyStep } from "@/components/onboarding/ReadyStep";
import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";

const STEPS = [
    { id: "welcome", label: "Welcome", hint: "Say hello" },
    { id: "profile", label: "Profile", hint: "Identity" },
    { id: "vault", label: "Vault", hint: "Custody" },
    { id: "risk", label: "Risk", hint: "Posture" },
    { id: "team", label: "Team", hint: "Co-signers" },
    { id: "ready", label: "Ready", hint: "Launch" },
] as const;

export interface OnboardingData {
    displayName: string;
    email: string;
    avatarSeed: string;
    organizationName: string;
    walletAddress: string;
    riskProfile: "conservative" | "moderate" | "aggressive";
    teamEmails: string[];
}

export default function OnboardingPage() {
    const router = useRouter();
    const { profile, updateProfile, isLoading } = useProfile();
    const [currentStep, setCurrentStep] = useState(0);
    const [data, setData] = useState<OnboardingData>({
        displayName: "",
        email: "",
        avatarSeed: `user_${Date.now()}`,
        organizationName: "",
        walletAddress: "",
        riskProfile: "moderate",
        teamEmails: [],
    });
    const [completing, setCompleting] = useState(false);

    useEffect(() => {
        if (profile && !isLoading) {
            setData((prev) => ({
                ...prev,
                displayName: profile.displayName || prev.displayName,
                avatarSeed: profile.avatarSeed || prev.avatarSeed,
                organizationName: profile.organizationName || prev.organizationName,
            }));
            if (profile.onboardingCompleted) router.push("/app");
        }
    }, [profile, isLoading, router]);

    const updateData = useCallback((updates: Partial<OnboardingData>) => {
        setData((prev) => ({ ...prev, ...updates }));
    }, []);

    const handleNext = useCallback(() => {
        setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, []);
    const handleBack = useCallback(() => {
        setCurrentStep((s) => Math.max(s - 1, 0));
    }, []);

    const handleComplete = useCallback(async () => {
        setCompleting(true);
        try {
            await updateProfile({
                displayName: data.displayName || undefined,
                email: data.email || undefined,
                avatarSeed: data.avatarSeed || undefined,
                organizationName: data.organizationName || undefined,
                onboardingCompleted: true,
            } as any);

            if (data.walletAddress) {
                try {
                    await fetch("/api/vault", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ address: data.walletAddress, label: "My Vault" }),
                    });
                } catch (e) {
                    console.warn("[Onboarding] Vault creation failed:", e);
                }
            }

            // Persist chosen risk profile to user_agent_policy so the DACS router enforces it.
            if (data.walletAddress && data.riskProfile) {
                const RISK_MAP: Record<string, { autoApproveBelowUsd: number; requireMultisigAboveUsd: number; dailyValueCapUsd: number }> = {
                    conservative: { autoApproveBelowUsd: 100, requireMultisigAboveUsd: 1_000, dailyValueCapUsd: 5_000 },
                    moderate:     { autoApproveBelowUsd: 500, requireMultisigAboveUsd: 10_000, dailyValueCapUsd: 25_000 },
                    aggressive:   { autoApproveBelowUsd: 2_000, requireMultisigAboveUsd: 50_000, dailyValueCapUsd: 100_000 },
                };
                const cfg = RISK_MAP[data.riskProfile];
                if (cfg) {
                    try {
                        await fetch("/api/dacs/policy", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ walletAddress: data.walletAddress, ...cfg }),
                        });
                    } catch (e) {
                        console.warn("[Onboarding] Risk policy save failed:", e);
                    }
                }
            }

            // Phase: Onboarding seed — provision one default watcher (SOL price < $100)
            // so a brand-new user lands on a non-empty agent.
            if (data.walletAddress) {
                try {
                    await fetch("/api/monitors", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            walletAddress: data.walletAddress,
                            type: "price",
                            target: "SOL",
                            operator: "below",
                            conditionValue: 100,
                            active: true,
                            label: "SOL drawdown alert",
                        }),
                    });
                } catch (e) {
                    console.warn("[Onboarding] Default monitor seed failed:", e);
                }
            }

            await fetch("/api/auth/refresh-session", { method: "POST" });

            if (data.email || data.teamEmails.length > 0) {
                fetch("/api/onboarding/complete-emails", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: data.email || undefined,
                        displayName: data.displayName || undefined,
                        teamEmails: data.teamEmails,
                    }),
                }).catch(() => {});
            }

            window.location.href = "/app";
        } catch (err) {
            console.error("[Onboarding] Failed to complete:", err);
            setCompleting(false);
        }
    }, [data, updateProfile]);

    const progress = useMemo(() => ((currentStep + 1) / STEPS.length) * 100, [currentStep]);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center font-manrope">
                <div className="flex flex-col items-center gap-5">
                    <DreyvStar size={36} className="text-violet-600 animate-pulse" />
                    <div className="h-[2px] w-40 bg-violet-100 overflow-hidden rounded-full">
                        <div className="h-full bg-violet-600 animate-[shimmer_1.4s_ease-in-out_infinite]" style={{ width: "55%" }} />
                    </div>
                </div>
            </div>
        );
    }

    const stepProps = { data, updateData, onNext: handleNext, onBack: handleBack };
    const isLast = currentStep === STEPS.length - 1;
    const mascotPose = currentStep === 0 ? "greet" : isLast ? "celebrate" : "think";

    return (
        <div className="relative flex h-screen flex-col overflow-hidden bg-white font-manrope text-slate-900">
            {/* Ambient violet glows — fixed so they don't expand the document */}
            <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -top-40 -left-40 h-[420px] w-[420px] rounded-full bg-violet-300/35 blur-[140px]" />
                <div className="absolute top-1/3 -right-32 h-[360px] w-[360px] rounded-full bg-violet-400/25 blur-[160px]" />
                <div className="absolute -bottom-40 left-1/3 h-[400px] w-[400px] rounded-full bg-violet-200/35 blur-[150px]" />
            </div>

            {/* Hairline grid texture */}
            <div
                aria-hidden
                className="pointer-events-none fixed inset-0 opacity-[0.025]"
                style={{
                    backgroundImage:
                        "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
                    backgroundSize: "56px 56px",
                }}
            />

            {/* Topbar */}
            <header className="relative z-10 px-4 sm:px-6 lg:px-10 pt-4 sm:pt-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <DreyvStar size={18} className="text-violet-600" />
                    <span className="text-[11px] sm:text-[12px] font-semibold tracking-[0.18em] uppercase text-slate-900">Dreyv · Setup</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-medium tracking-[0.18em] uppercase text-slate-500">
                    <span className="tabular-nums text-slate-900">{String(currentStep + 1).padStart(2, "0")}</span>
                    <span className="h-px w-5 bg-slate-300" />
                    <span className="tabular-nums">{String(STEPS.length).padStart(2, "0")}</span>
                </div>
            </header>

            {/* Stepper rail */}
            <nav className="relative z-10 mt-4 sm:mt-5 px-4 sm:px-6 lg:px-10">
                <div className="mx-auto max-w-5xl">
                    <ol className="grid grid-cols-6 gap-1.5 sm:gap-2">
                        {STEPS.map((step, i) => {
                            const state = i < currentStep ? "done" : i === currentStep ? "current" : "todo";
                            return (
                                <li key={step.id} className="flex flex-col gap-1.5">
                                    <div className="relative h-[2px] w-full rounded-full bg-violet-100 overflow-hidden">
                                        <div
                                            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${
                                                state === "done" ? "w-full bg-violet-600" : state === "current" ? "w-2/3 bg-violet-600" : "w-0"
                                            }`}
                                        />
                                    </div>
                                    <div className="flex items-baseline gap-1.5">
                                        <span
                                            className={`text-[9px] tabular-nums font-semibold tracking-[0.16em] ${
                                                state === "todo" ? "text-slate-400" : "text-violet-600"
                                            }`}
                                        >
                                            0{i + 1}
                                        </span>
                                        <span
                                            className={`hidden sm:inline text-[10px] font-semibold tracking-[0.12em] uppercase truncate ${
                                                state === "todo" ? "text-slate-400" : "text-slate-900"
                                            }`}
                                        >
                                            {step.label}
                                        </span>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            </nav>

            {/* Main content — fills remaining space, inner area scrolls if it overflows */}
            <main className="relative z-10 flex-1 min-h-0 px-4 sm:px-6 lg:px-10 pt-4 sm:pt-5 pb-3">
                <div className="mx-auto h-full max-w-5xl">
                    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_minmax(0,200px)] gap-4 items-stretch">
                        <section
                            key={currentStep}
                            className="rounded-2xl sm:rounded-[20px] border border-violet-100 bg-white/85 backdrop-blur-sm p-4 sm:p-5 lg:p-6 overflow-y-auto animate-in fade-in slide-in-from-bottom-3 duration-500"
                        >
                            {currentStep === 0 && <WelcomeStep {...stepProps} />}
                            {currentStep === 1 && <ProfileStep {...stepProps} />}
                            {currentStep === 2 && <VaultStep {...stepProps} />}
                            {currentStep === 3 && <RiskStep {...stepProps} />}
                            {currentStep === 4 && <TeamInviteStep {...stepProps} />}
                            {currentStep === 5 && <ReadyStep {...stepProps} onComplete={handleComplete} completing={completing} />}
                        </section>

                        {/* Side rail — mascot + step compass (desktop) */}
                        <aside className="hidden lg:flex flex-col gap-3 overflow-y-auto">
                            <div className="rounded-2xl border border-violet-100 bg-white p-3 flex flex-col items-center text-center">
                                <DreyvMascot pose={mascotPose} size={72} />
                                <p className="mt-1.5 text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-600">
                                    Dreyv
                                </p>
                                <p className="mt-1 text-[10.5px] text-slate-500 leading-relaxed">
                                    {currentStep === 0 && "Five quick steps. You stay in custody."}
                                    {currentStep === 1 && "Shows up across signers, alerts and reports."}
                                    {currentStep === 2 && "Squads vault or single signer — read-only is fine."}
                                    {currentStep === 3 && "Sets agent guardrails. Tweak anytime."}
                                    {currentStep === 4 && "Skip if solo — invite later."}
                                    {currentStep === 5 && "Looks ready. Let's launch."}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-3">
                                <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Compass</p>
                                <ul className="mt-2 space-y-1.5">
                                    {STEPS.map((s, i) => (
                                        <li key={s.id} className="flex items-center gap-2">
                                            <DreyvStar
                                                size={i === currentStep ? 11 : 8}
                                                className={`text-violet-600 ${i > currentStep ? "opacity-30" : ""}`}
                                            />
                                            <span
                                                className={`text-[11px] tracking-wide ${
                                                    i === currentStep
                                                        ? "text-slate-900 font-semibold"
                                                        : i < currentStep
                                                        ? "text-slate-500"
                                                        : "text-slate-400"
                                                }`}
                                            >
                                                {s.label}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </aside>
                    </div>
                </div>
            </main>

            {/* Navigation footer — in document flow, sticks to bottom of viewport when content is short */}
            <footer className="relative z-10 px-4 sm:px-6 lg:px-10 pb-3 sm:pb-4">
                <div className="mx-auto max-w-5xl">
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-100 bg-white px-4 sm:px-5 py-2.5">
                        <button
                            onClick={handleBack}
                            disabled={currentStep === 0}
                            className="text-[11px] font-semibold tracking-[0.18em] uppercase text-slate-500 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            ← Back
                        </button>

                        <div className="flex-1 mx-2 sm:mx-4 hidden sm:flex items-center gap-2">
                            <div className="flex-1 h-[2px] rounded-full bg-violet-100 overflow-hidden">
                                <div
                                    className="h-full bg-violet-600 transition-all duration-700 ease-out"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <span className="text-[10px] tabular-nums tracking-widest text-slate-500 w-10 text-right">
                                {Math.round(progress)}%
                            </span>
                        </div>

                        {!isLast ? (
                            <button
                                onClick={handleNext}
                                className="group inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold tracking-[0.16em] uppercase px-5 sm:px-6 py-2.5 transition-colors"
                            >
                                Continue
                                <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
                            </button>
                        ) : (
                            <button
                                onClick={handleComplete}
                                disabled={completing}
                                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold tracking-[0.16em] uppercase px-5 sm:px-6 py-2.5 transition-colors disabled:opacity-60"
                            >
                                {completing ? "Launching…" : "Launch Dreyv →"}
                            </button>
                        )}
                    </div>
                </div>
            </footer>

            <style jsx global>{`
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(200%); }
                }
            `}</style>
        </div>
    );
}
