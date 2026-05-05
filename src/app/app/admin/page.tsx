"use client";

import React, { useEffect, useState } from "react";
import {
    Users, Activity, Zap, Bot, Package, Shield,
    ArrowRightLeft, RefreshCw, Server, AlertTriangle,
} from "lucide-react";
import { AdminMetricsPanel, MetricGrid, BreakdownList } from "@/components/admin/AdminMetricsPanel";
import { MetricCard } from "@/components/admin/MetricCard";
import { InngestHealthPanel } from "@/components/admin/InngestHealthPanel";
import { PlatformReportPanel } from "@/components/admin/PlatformReportPanel";

export default function AdminMonitoringRoom() {
    const [metrics, setMetrics] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const fetchMetrics = async () => {
        try {
            setError(null);
            const res = await fetch("/api/admin/metrics");
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    throw new Error("Unauthorized: Admin access required.");
                }
                throw new Error(`Failed to fetch metrics: ${res.status}`);
            }
            const data = await res.json();
            setMetrics(data);
            setLastRefresh(new Date());
        } catch (err: any) {
            setError(err.message || "An error occurred");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMetrics();
        const interval = setInterval(fetchMetrics, 60000);
        return () => clearInterval(interval);
    }, []);

    if (error) {
        return (
            <div className="dreyv-marketing-root relative min-h-dvh w-full font-manrope bg-white text-slate-900 flex flex-col items-center justify-center px-6">
                <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
                    <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
                    <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
                </div>
                <div className="relative z-10 max-w-md w-full rounded-3xl border border-violet-200/60 bg-white/85 backdrop-blur-md p-8 text-center shadow-[0_20px_60px_-30px_rgba(124,58,237,0.20)]">
                    <div className="mx-auto h-12 w-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600">
                        <AlertTriangle size={22} />
                    </div>
                    <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">Access denied</h1>
                    <p className="mt-2 text-sm text-slate-600">{error}</p>
                </div>
            </div>
        );
    }

    if (loading && !metrics) {
        return (
            <div className="dreyv-marketing-root relative min-h-dvh w-full font-manrope bg-white text-slate-900 flex flex-col items-center justify-center">
                <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
                    <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
                    <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
                </div>
                <div className="relative z-10 flex flex-col items-center gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-violet-100 border border-violet-200 flex items-center justify-center text-violet-700">
                        <Server size={20} className="animate-pulse" />
                    </div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Initializing monitoring room…
                    </p>
                </div>
            </div>
        );
    }

    // Defensive defaults so a partial API response never crashes the grid.
    const m = metrics ?? {};
    const safe = {
        users: { total: 0, new24h: 0, new7d: 0, onboarded: 0, withEmail: 0, ...(m.users ?? {}) },
        revenue: {
            totalMarketplaceVol: 0, totalMarketplaceRev: 0,
            tiers: { free: 0, mini: 0, max: 0, ...((m.revenue?.tiers) ?? {}) },
            ...(m.revenue ?? {}),
        },
        ai: {
            totalExecutions: 0, executions24h: 0, totalRuns: 0,
            executionStatus: { SUCCESS: 0, PENDING: 0, SIMULATING: 0, FAILED: 0, ...((m.ai?.executionStatus) ?? {}) },
            ...(m.ai ?? {}),
        },
        dca: {
            activeBots: 0, totalInvested: 0, volume24h: 0,
            botsStatus: { active: 0, completed: 0, paused: 0, failed: 0, ...((m.dca?.botsStatus) ?? {}) },
            ...(m.dca ?? {}),
        },
        marketplace: { totalApps: 0, publishedApps: 0, activeInstalls: 0, ...(m.marketplace ?? {}) },
        onchain: { txCount: 0, usdVol: 0, airdropClaims: 0, airdropValue: 0, ...(m.onchain ?? {}) },
        teams: { total: 0, vaultLinked: 0, invitesTotal: 0, invitesAccepted: 0, ...(m.teams ?? {}) },
        system: { rateLimitHits24h: 0, activeMonitors: 0, activeAtlasSessions: 0, foresightAccuracy: 0, ...(m.system ?? {}) },
    };

    return (
        <div className="dreyv-marketing-root relative min-h-dvh w-full font-manrope bg-white text-slate-900 overflow-x-hidden">
            {/* Ambient violet light */}
            <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
                <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
                <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
                <div className="absolute inset-0 noise-overlay opacity-[0.025]" />
            </div>

            {/* Header */}
            <header className="relative z-20 sticky top-0 backdrop-blur-md bg-white/75 border-b border-violet-100">
                <div className="mx-auto max-w-[1800px] px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-2xl bg-violet-100 border border-violet-200 flex items-center justify-center text-violet-700">
                            <Server size={18} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                                    dreyv · Admin
                                </span>
                            </div>
                            <h1 className="mt-1 text-lg md:text-xl font-semibold tracking-tight text-slate-900">
                                Monitoring room
                            </h1>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-violet-600 animate-pulse" />
                                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                    Live telemetry
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="hidden sm:inline-flex text-[10px] font-mono text-slate-500">
                            Last ping {lastRefresh?.toLocaleTimeString() || "…"}
                        </span>
                        <button
                            onClick={() => { setLoading(true); fetchMetrics(); }}
                            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 hover:border-violet-400 hover:text-violet-700 transition-colors"
                        >
                            <RefreshCw size={13} className={`text-violet-600 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </button>
                    </div>
                </div>
            </header>

            <main className="relative z-10 px-4 sm:px-6 py-6 sm:py-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-[1800px] mx-auto pb-12">

                    {/* PANEL 0: Inngest agent runtime — rendered first so it shows even if other metrics fail */}
                    <InngestHealthPanel />


                    {/* PANEL 1: User Growth */}
                    <AdminMetricsPanel
                        title="User growth & adoption"
                        icon={<Users size={16} />}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={2}>
                            <MetricCard
                                title="Total users"
                                value={safe.users.total}
                                trend={{ value: safe.users.new24h, prefix: "+", subtext: "last 24h" }}
                            />
                            <MetricCard
                                title="New this week"
                                value={safe.users.new7d}
                            />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Conversion targets
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Onboarded", value: safe.users.onboarded, color: "#7c3aed" },
                                    { label: "Emails collected", value: safe.users.withEmail, color: "#a78bfa" },
                                ]}
                                valueFormatter={(v) => `${v} users (${Math.round((v / safe.users.total) * 100 || 0)}%)`}
                            />
                        </div>
                    </AdminMetricsPanel>

                    {/* PANEL 2: Financials */}
                    <AdminMetricsPanel
                        title="Financials & tiers"
                        icon={<Activity size={16} />}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={2}>
                            <MetricCard
                                title="Marketplace volume"
                                value={safe.revenue.totalMarketplaceVol}
                                formatter={(v) => `$${v.toLocaleString()}`}
                            />
                            <MetricCard
                                title="Platform fees"
                                value={safe.revenue.totalMarketplaceRev}
                                formatter={(v) => `$${v.toLocaleString()}`}
                            />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Tier distribution
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Free tier", value: safe.revenue.tiers.free || 0, color: "#cbd5e1" },
                                    { label: "Mini tier", value: safe.revenue.tiers.mini || 0, color: "#a78bfa" },
                                    { label: "Max tier", value: safe.revenue.tiers.max || 0, color: "#7c3aed" },
                                ]}
                            />
                        </div>
                    </AdminMetricsPanel>

                    {/* PANEL 3: AI Agents */}
                    <AdminMetricsPanel
                        title="AI agent fleet"
                        icon={<Bot size={16} />}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={2}>
                            <MetricCard
                                title="Total executions"
                                value={safe.ai.totalExecutions}
                                trend={{ value: safe.ai.executions24h, prefix: "+", subtext: "last 24h" }}
                            />
                            <MetricCard
                                title="Architect runs"
                                value={safe.ai.totalRuns}
                            />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Execution status pipeline
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Successful", value: safe.ai.executionStatus.SUCCESS || 0, color: "#7c3aed" },
                                    { label: "Pending / simulating", value: (safe.ai.executionStatus.PENDING || 0) + (safe.ai.executionStatus.SIMULATING || 0), color: "#f59e0b" },
                                    { label: "Failed", value: safe.ai.executionStatus.FAILED || 0, color: "#f43f5e" },
                                ]}
                            />
                        </div>
                    </AdminMetricsPanel>

                    {/* PANEL 4: DCA */}
                    <AdminMetricsPanel
                        title="DCA automation"
                        icon={<Zap size={16} />}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={2}>
                            <MetricCard
                                title="Active bots"
                                value={safe.dca.activeBots}
                            />
                            <MetricCard
                                title="Total invested"
                                value={safe.dca.totalInvested}
                                formatter={(v) => `$${v.toLocaleString()}`}
                                trend={{ value: safe.dca.volume24h, prefix: "+$", subtext: "last 24h" }}
                            />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Bot lifecycle
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Active", value: safe.dca.botsStatus.active || 0, color: "#7c3aed" },
                                    { label: "Completed", value: safe.dca.botsStatus.completed || 0, color: "#cbd5e1" },
                                    { label: "Paused / failed", value: (safe.dca.botsStatus.paused || 0) + (safe.dca.botsStatus.failed || 0), color: "#f43f5e" },
                                ]}
                            />
                        </div>
                    </AdminMetricsPanel>

                    {/* PANEL 5: Marketplace */}
                    <AdminMetricsPanel
                        title="App marketplace"
                        icon={<Package size={16} />}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={3}>
                            <MetricCard title="Apps created" value={safe.marketplace.totalApps} />
                            <MetricCard title="Published" value={safe.marketplace.publishedApps} />
                            <MetricCard title="Active installs" value={safe.marketplace.activeInstalls} />
                        </MetricGrid>
                    </AdminMetricsPanel>

                    {/* PANEL 6: On-chain */}
                    <AdminMetricsPanel
                        title="On-chain & TX volume"
                        icon={<ArrowRightLeft size={16} />}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={2}>
                            <MetricCard title="Tracked TXs" value={safe.onchain.txCount} />
                            <MetricCard
                                title="Tracked volume"
                                value={safe.onchain.usdVol}
                                formatter={(v) => `$${Math.round(v).toLocaleString()}`}
                            />
                            <MetricCard
                                title="Airdrops claimed"
                                value={safe.onchain.airdropClaims}
                            />
                            <MetricCard
                                title="Airdrop yield"
                                value={safe.onchain.airdropValue}
                                formatter={(v) => `$${Math.round(v).toLocaleString()}`}
                            />
                        </MetricGrid>
                    </AdminMetricsPanel>

                    {/* PANEL 7: Teams */}
                    <AdminMetricsPanel
                        title="Teams & collaboration"
                        icon={<Users size={16} />}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={2}>
                            <MetricCard title="Total teams" value={safe.teams.total} />
                            <MetricCard title="Vault-linked teams" value={safe.teams.vaultLinked} />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Invitation funnel
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Sent", value: safe.teams.invitesTotal, color: "#cbd5e1" },
                                    { label: "Accepted", value: safe.teams.invitesAccepted, color: "#7c3aed" },
                                ]}
                            />
                        </div>
                    </AdminMetricsPanel>

                    {/* PANEL 8: System Health */}
                    <AdminMetricsPanel
                        title="System health & events"
                        icon={<Shield size={16} />}
                        status={safe.system.rateLimitHits24h > 1000 ? "warning" : "healthy"}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={2}>
                            <MetricCard
                                title="Rate-limit hits (24h)"
                                value={safe.system.rateLimitHits24h}
                                colorClass={safe.system.rateLimitHits24h > 1000 ? "text-amber-600" : "text-slate-700"}
                            />
                            <MetricCard title="Active monitors" value={safe.system.activeMonitors} />
                            <MetricCard title="Active atlas sessions" value={safe.system.activeAtlasSessions} />
                            <MetricCard
                                title="Foresight accuracy"
                                value={safe.system.foresightAccuracy}
                                formatter={(v) => `${(v * 100).toFixed(1)}%`}
                            />
                        </MetricGrid>
                    </AdminMetricsPanel>

                    {/* PANEL 9: Inngest agent runtime */}
                    <InngestHealthPanel />
                </div>
            </main>
        </div>
    );
}
