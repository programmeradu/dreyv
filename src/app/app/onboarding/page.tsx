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
import { DryvMascot } from "@/components/brand/dryv-mascot";
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
        <div className="relative min-h-screen bg-white font-manrope text-slate-900 overflow-hidden">
            {/* Ambient violet glows — flat, no gradients on UI surfaces */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-violet-300/40 blur-[140px]" />
                <div className="absolute top-1/3 -right-32 h-[420px] w-[420px] rounded-full bg-violet-400/30 blur-[160px]" />
                <div className="absolute -bottom-40 left-1/3 h-[480px] w-[480px] rounded-full bg-violet-200/40 blur-[150px]" />
            </div>

            {/* Hairline grid texture */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.025]"
                style={{
                    backgroundImage:
                        "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
                    backgroundSize: "56px 56px",
                }}
            />

            {/* Topbar */}
            <header className="relative z-10 px-6 lg:px-10 pt-6 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <DreyvStar size={22} className="text-violet-600" />
                    <span className="text-[13px] font-semibold tracking-[0.18em] uppercase text-slate-900">Dreyv · Setup</span>
                </div>
                <div className="hidden sm:flex items-center gap-3 text-[11px] font-medium tracking-[0.18em] uppercase text-slate-500">
                    <span className="tabular-nums text-slate-900">{String(currentStep + 1).padStart(2, "0")}</span>
                    <span className="h-px w-6 bg-slate-300" />
                    <span className="tabular-nums">{String(STEPS.length).padStart(2, "0")}</span>
                </div>
            </header>

            {/* Stepper rail */}
            <nav className="relative z-10 mt-8 px-6 lg:px-10">
                <div className="mx-auto max-w-5xl">
                    <ol className="grid grid-cols-6 gap-2">
                        {STEPS.map((step, i) => {
                            const state = i < currentStep ? "done" : i === currentStep ? "current" : "todo";
                            return (
                                <li key={step.id} className="flex flex-col gap-2">
                                    <div className="relative h-[3px] w-full rounded-full bg-violet-100 overflow-hidden">
                                        <div
                                            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${
                                                state === "done" ? "w-full bg-violet-600" : state === "current" ? "w-2/3 bg-violet-600" : "w-0"
                                            }`}
                                        />
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                        <span
                                            className={`text-[10px] tabular-nums font-semibold tracking-[0.18em] ${
                                                state === "todo" ? "text-slate-400" : "text-violet-600"
                                            }`}
                                        >
                                            0{i + 1}
                                        </span>
                                        <span
                                            className={`text-[11px] font-semibold tracking-[0.12em] uppercase truncate ${
                                                state === "todo" ? "text-slate-400" : "text-slate-900"
                                            }`}
                                        >
                                            {step.label}
                                        </span>
                                    </div>
                                    <span className="hidden md:block text-[10px] text-slate-400 tracking-wide">{step.hint}</span>
                                </li>
                            );
                        })}
                    </ol>
                    <div className="mt-4 flex items-center justify-between text-[10px] tracking-[0.18em] uppercase text-slate-400">
                        <span>Progress</span>
                        <span className="tabular-nums text-slate-900">{Math.round(progress)}%</span>
                    </div>
                </div>
            </nav>

            {/* Main content */}
            <main className="relative z-10 px-6 lg:px-10 pb-40 pt-10 sm:pt-14">
                <div className="mx-auto max-w-5xl">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,260px)] gap-10 items-start">
                        <section
                            key={currentStep}
                            className="rounded-[28px] border border-violet-100 bg-white/85 backdrop-blur-sm p-6 sm:p-10 lg:p-12 animate-in fade-in slide-in-from-bottom-3 duration-500"
                        >
                            {currentStep === 0 && <WelcomeStep {...stepProps} />}
                            {currentStep === 1 && <ProfileStep {...stepProps} />}
                            {currentStep === 2 && <VaultStep {...stepProps} />}
                            {currentStep === 3 && <RiskStep {...stepProps} />}
                            {currentStep === 4 && <TeamInviteStep {...stepProps} />}
                            {currentStep === 5 && <ReadyStep {...stepProps} onComplete={handleComplete} completing={completing} />}
                        </section>

                        {/* Side rail — mascot + step compass (desktop) */}
                        <aside className="hidden lg:flex flex-col gap-5 sticky top-10">
                            <div className="rounded-3xl border border-violet-100 bg-white p-6 flex flex-col items-center text-center">
                                <DryvMascot pose={mascotPose} size={140} />
                                <p className="mt-4 text-[11px] tracking-[0.2em] uppercase font-semibold text-violet-600">
                                    Dryv
                                </p>
                                <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">
                                    {currentStep === 0 && "Five quick steps. You stay in custody the whole way."}
                                    {currentStep === 1 && "Your name and org show up across signers, alerts and reports."}
                                    {currentStep === 2 && "Connect any Squads vault or single signer — read-only is fine."}
                                    {currentStep === 3 && "Sets agent guardrails. Tweak it anytime from Agent Settings."}
                                    {currentStep === 4 && "Skip if solo — co-signers can be added later."}
                                    {currentStep === 5 && "Everything looks ready. Let's launch your treasury."}
                                </p>
                            </div>

                            <div className="rounded-3xl border border-violet-100 bg-violet-50/50 p-5">
                                <p className="text-[10px] tracking-[0.2em] uppercase font-semibold text-violet-700">Compass</p>
                                <ul className="mt-3 space-y-2.5">
                                    {STEPS.map((s, i) => (
                                        <li key={s.id} className="flex items-center gap-2.5">
                                            <span
                                                className={`flex h-1.5 w-1.5 ${
                                                    i === currentStep
                                                        ? "scale-150"
                                                        : i < currentStep
                                                        ? ""
                                                        : "opacity-30"
                                                }`}
                                            >
                                                <DreyvStar size={i === currentStep ? 12 : 8} className="text-violet-600 -mt-1" />
                                            </span>
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

            {/* Floating navigation footer */}
            <footer className="fixed inset-x-0 bottom-0 z-20 px-6 lg:px-10 pb-6">
                <div className="mx-auto max-w-5xl">
                    <div className="flex items-center justify-between gap-4 rounded-2xl border border-violet-100 bg-white/90 backdrop-blur-md px-4 sm:px-6 py-3">
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
