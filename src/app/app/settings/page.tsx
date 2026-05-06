"use client";

import React, { Suspense, useState, useEffect, useRef } from "react";
import { Settings as SettingsIcon, Shield, Bell, Key, Smartphone, Fingerprint, Cpu, CreditCard, Gavel, LayoutGrid, ExternalLink } from "lucide-react";
import { RiskProfileSelector } from "@/components/agents/RiskProfileSelector";
import { CollaborativeHeader } from "@/components/CollaborativeHeader";
import { WalletButton } from "@/components/WalletButton";
import { ProfileView } from "@/components/settings/ProfileView";
import { NotificationsView } from "@/components/settings/NotificationsView";
import { ApiKeysView } from "@/components/settings/ApiKeysView";
import { BillingView } from "@/components/settings/BillingView";
import { AgentPolicyView } from "@/components/settings/AgentPolicyView";
import { PolicySuggestionsPanel } from "@/components/settings/PolicySuggestionsPanel";
import { SubagentsPanel } from "@/components/settings/SubagentsPanel";
import { HandoffsPanel } from "@/components/settings/HandoffsPanel";
import { NetworkSelector } from "@/components/NetworkSelector";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { useNotificationStore } from "@/lib/notifications";
import { toast } from "@/lib/toast-notifications";

type SettingsView = "general" | "profile" | "notifications" | "api" | "billing" | "policy";

const NAV: { id: SettingsView; label: string; icon: any; hint: string }[] = [
    { id: "general", label: "Overview", icon: LayoutGrid, hint: "System & agent posture" },
    { id: "profile", label: "Identity", icon: Fingerprint, hint: "Profile & sessions" },
    { id: "policy", label: "Agent policy", icon: Shield, hint: "Guardrails & sub-agents" },
    { id: "notifications", label: "Signals", icon: Bell, hint: "Alerts & channels" },
    { id: "api", label: "API keys", icon: Key, hint: "Access tokens" },
    { id: "billing", label: "Billing", icon: CreditCard, hint: "Plan & invoices" },
];

export default function SettingsPage() {
    const [currentView, setCurrentView] = useState<SettingsView>("general");
    const unreadCount = useNotificationStore((s) => s.notifications.filter((n) => !n.read).length);
    const deferredPrompt = useRef<any>(null);
    useDeclareFocus({ scope: "settings", label: "Settings", data: { view: currentView, unreadCount } }, [currentView, unreadCount]);

    useEffect(() => {
        const handler = (e: Event) => { e.preventDefault(); deferredPrompt.current = e; };
        window.addEventListener("beforeinstallprompt", handler);
        return () => window.removeEventListener("beforeinstallprompt", handler);
    }, []);

    const handleInstallPwa = async () => {
        if (deferredPrompt.current) {
            deferredPrompt.current.prompt();
            const result = await deferredPrompt.current.userChoice;
            if (result.outcome === "accepted") toast.success("PWA installed");
            deferredPrompt.current = null;
        } else {
            toast.info("Use your browser's Install App option (or Add to Home Screen on mobile).");
        }
    };

    const renderContent = () => {
        switch (currentView) {
            case "profile":
                return <ProfileView onNavigate={(view: string) => setCurrentView(view as SettingsView)} />;
            case "notifications":
                return <NotificationsView />;
            case "api":
                return <ApiKeysView />;
            case "billing":
                return <BillingView />;
            case "policy":
                return (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <PolicySuggestionsPanel />
                        <AgentPolicyView />
                        <SubagentsPanel />
                        <HandoffsPanel />
                    </div>
                );
            default:
                return (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <Section
                            eyebrow="Agent posture"
                            title="How should the agent behave?"
                            subtitle="Sets default guardrails for autonomous actions. Same three profiles as onboarding."
                            icon={Cpu}
                        >
                            <RiskProfileSelector />
                        </Section>

                        <Section
                            eyebrow="Multisig"
                            title="On-chain governance via Squads"
                            subtitle="When a vault is configured as a Squads v4 multisig, signers, thresholds and timelocks are enforced on-chain — not by Dreyv."
                            icon={Gavel}
                        >
                            <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/30 p-8 flex flex-col items-center text-center gap-4">
                                <div className="h-14 w-14 rounded-2xl bg-white border border-violet-100 flex items-center justify-center shadow-[0_12px_30px_-12px_rgba(124,58,237,0.35)]">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src="/logos/squads.png" alt="Squads Protocol" className="h-8 w-8 object-contain" />
                                </div>
                                <div>
                                    <h3 className="text-[15px] font-semibold text-slate-900">Powered by Squads Protocol v4</h3>
                                    <p className="mt-1 text-[12px] text-slate-500 max-w-sm">
                                        Proposals, approvals and execution flow through Squads. Use the explorer to inspect or rotate signers — Dreyv cannot override on-chain policy.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => window.open("https://app.squads.so", "_blank")}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold transition shadow-sm"
                                    >
                                        Open Squads <ExternalLink size={12} />
                                    </button>
                                    <a
                                        href="/app/team"
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-violet-200 text-violet-700 hover:bg-violet-50 text-[12px] font-semibold transition"
                                    >
                                        Manage signers
                                    </a>
                                </div>
                            </div>
                        </Section>
                    </div>
                );
        }
    };

    return (
        <div className="dreyv-marketing-root flex flex-col w-full max-w-full overflow-x-hidden md:h-screen md:overflow-hidden bg-white text-slate-900 font-manrope relative">
            {/* Ambient violet glows */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 -left-32 h-[420px] w-[420px] rounded-full bg-violet-300/30 blur-[120px]" />
                <div className="absolute -bottom-40 -right-32 h-[460px] w-[460px] rounded-full bg-violet-400/20 blur-[140px]" />
            </div>

            {/* Header */}
            <header className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 sm:px-8 py-4 border-b border-violet-100 bg-white/70 backdrop-blur-md">
                <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <DreyvStar size={10} className="text-violet-600" />
                        <span className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Dreyv OS · Configuration</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                        <SettingsIcon className="text-slate-700 shrink-0" size={18} />
                        <h1 className="text-[20px] sm:text-[24px] font-semibold tracking-[-0.01em] text-slate-900">Settings</h1>
                    </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <NetworkSelector />
                    <Suspense fallback={<div className="h-8 w-24 bg-violet-50 animate-pulse rounded-full" />}>
                        <CollaborativeHeader />
                    </Suspense>
                    <div className="hidden sm:block w-px h-6 bg-violet-100 mx-1" />
                    <WalletButton />
                </div>
            </header>

            <main className="relative z-10 flex-1 md:overflow-y-auto scrollbar-thin px-5 sm:px-8 py-6 sm:py-8">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 lg:gap-10">
                    {/* Sidebar nav */}
                    <aside className="lg:sticky lg:top-6 self-start">
                        <nav className="rounded-2xl border border-violet-100 bg-white/80 backdrop-blur p-2">
                            {NAV.map((item) => {
                                const Icon = item.icon;
                                const active = currentView === item.id;
                                const badge = item.id === "notifications" && unreadCount > 0 ? unreadCount : null;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => setCurrentView(item.id)}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                                            active
                                                ? "bg-violet-50 text-slate-900"
                                                : "text-slate-600 hover:bg-violet-50/60 hover:text-slate-900"
                                        }`}
                                    >
                                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-600"}`}>
                                            <Icon size={14} />
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-[13px] font-semibold">{item.label}</span>
                                            <span className="block text-[10px] text-slate-400 truncate">{item.hint}</span>
                                        </span>
                                        {badge && (
                                            <span className="px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-semibold tabular-nums">
                                                {badge}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </nav>

                        {/* PWA promo */}
                        <div className="mt-4 rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-5 relative overflow-hidden">
                            <div className="h-10 w-10 rounded-xl bg-violet-600 flex items-center justify-center text-white mb-3 shadow-[0_12px_30px_-12px_rgba(124,58,237,0.6)]">
                                <Smartphone size={18} />
                            </div>
                            <h3 className="text-[14px] font-semibold text-slate-900">Dreyv Mobile</h3>
                            <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                                Sign transactions on the go. Install as a PWA for biometric approval.
                            </p>
                            <button
                                onClick={handleInstallPwa}
                                className="mt-3 w-full py-2 rounded-full bg-white border border-violet-200 hover:border-violet-400 text-[11px] font-semibold text-slate-700 transition flex items-center justify-center gap-1.5"
                            >
                                <Smartphone size={12} /> Install PWA
                            </button>
                        </div>
                    </aside>

                    {/* Main column */}
                    <div className="min-w-0">
                        {renderContent()}
                    </div>
                </div>
            </main>
        </div>
    );
}

function Section({
    eyebrow,
    title,
    subtitle,
    icon: Icon,
    children,
}: {
    eyebrow: string;
    title: string;
    subtitle?: string;
    icon: any;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-3xl border border-violet-100 bg-white p-6 sm:p-7">
            <header className="flex items-start gap-4 mb-6">
                <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600 ring-1 ring-violet-100">
                    <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">{eyebrow}</p>
                    <h2 className="mt-1 text-[20px] sm:text-[22px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h2>
                    {subtitle && <p className="mt-1 text-[13px] text-slate-500">{subtitle}</p>}
                </div>
            </header>
            {children}
        </section>
    );
}
