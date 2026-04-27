"use client";

import React, { useEffect, useState } from "react";
import {
    Users, Activity, Zap, Bot, Package, Shield,
    ArrowRightLeft, RefreshCw, Server, AlertTriangle,
} from "lucide-react";
import { AdminMetricsPanel, MetricGrid, BreakdownList } from "@/components/admin/AdminMetricsPanel";
import { MetricCard } from "@/components/admin/MetricCard";
import { InngestHealthPanel } from "@/components/admin/InngestHealthPanel";

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

    return (
        <div className="dreyv-marketing-root relative min-h-dvh w-full font-manrope bg-white text-slate-900">
            {/* Ambient violet light */}
            <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
                <div className="absolute top-[-12%] left-[-10%] h-[620px] w-[620px] rounded-full bg-violet-400/[0.10] blur-[130px]" />
                <div className="absolute top-[20%] right-[-6%] h-[520px] w-[520px] rounded-full bg-violet-300/[0.08] blur-[120px]" />
                <div className="absolute inset-0 noise-overlay opacity-[0.025]" />
            </div>

            {/* Header */}
            <header className="relative z-20 sticky top-0 backdrop-blur-md bg-white/75 border-b border-violet-100">
                <div className="mx-auto max-w-[1800px] px-6 py-4 flex items-center justify-between gap-4">
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

            <main className="relative z-10 px-6 py-8 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-[1800px] mx-auto pb-12">

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
                                value={metrics.users.total}
                                trend={{ value: metrics.users.new24h, prefix: "+", subtext: "last 24h" }}
                            />
                            <MetricCard
                                title="New this week"
                                value={metrics.users.new7d}
                            />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Conversion targets
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Onboarded", value: metrics.users.onboarded, color: "#7c3aed" },
                                    { label: "Emails collected", value: metrics.users.withEmail, color: "#a78bfa" },
                                ]}
                                valueFormatter={(v) => `${v} users (${Math.round((v / metrics.users.total) * 100 || 0)}%)`}
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
                                value={metrics.revenue.totalMarketplaceVol}
                                formatter={(v) => `$${v.toLocaleString()}`}
                            />
                            <MetricCard
                                title="Platform fees"
                                value={metrics.revenue.totalMarketplaceRev}
                                formatter={(v) => `$${v.toLocaleString()}`}
                            />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Tier distribution
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Free tier", value: metrics.revenue.tiers.free || 0, color: "#cbd5e1" },
                                    { label: "Mini tier", value: metrics.revenue.tiers.mini || 0, color: "#a78bfa" },
                                    { label: "Max tier", value: metrics.revenue.tiers.max || 0, color: "#7c3aed" },
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
                                value={metrics.ai.totalExecutions}
                                trend={{ value: metrics.ai.executions24h, prefix: "+", subtext: "last 24h" }}
                            />
                            <MetricCard
                                title="Architect runs"
                                value={metrics.ai.totalRuns}
                            />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Execution status pipeline
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Successful", value: metrics.ai.executionStatus.SUCCESS || 0, color: "#7c3aed" },
                                    { label: "Pending / simulating", value: (metrics.ai.executionStatus.PENDING || 0) + (metrics.ai.executionStatus.SIMULATING || 0), color: "#f59e0b" },
                                    { label: "Failed", value: metrics.ai.executionStatus.FAILED || 0, color: "#f43f5e" },
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
                                value={metrics.dca.activeBots}
                            />
                            <MetricCard
                                title="Total invested"
                                value={metrics.dca.totalInvested}
                                formatter={(v) => `$${v.toLocaleString()}`}
                                trend={{ value: metrics.dca.volume24h, prefix: "+$", subtext: "last 24h" }}
                            />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Bot lifecycle
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Active", value: metrics.dca.botsStatus.active || 0, color: "#7c3aed" },
                                    { label: "Completed", value: metrics.dca.botsStatus.completed || 0, color: "#cbd5e1" },
                                    { label: "Paused / failed", value: (metrics.dca.botsStatus.paused || 0) + (metrics.dca.botsStatus.failed || 0), color: "#f43f5e" },
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
                            <MetricCard title="Apps created" value={metrics.marketplace.totalApps} />
                            <MetricCard title="Published" value={metrics.marketplace.publishedApps} />
                            <MetricCard title="Active installs" value={metrics.marketplace.activeInstalls} />
                        </MetricGrid>
                    </AdminMetricsPanel>

                    {/* PANEL 6: On-chain */}
                    <AdminMetricsPanel
                        title="On-chain & TX volume"
                        icon={<ArrowRightLeft size={16} />}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={2}>
                            <MetricCard title="Tracked TXs" value={metrics.onchain.txCount} />
                            <MetricCard
                                title="Tracked volume"
                                value={metrics.onchain.usdVol}
                                formatter={(v) => `$${Math.round(v).toLocaleString()}`}
                            />
                            <MetricCard
                                title="Airdrops claimed"
                                value={metrics.onchain.airdropClaims}
                            />
                            <MetricCard
                                title="Airdrop yield"
                                value={metrics.onchain.airdropValue}
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
                            <MetricCard title="Total teams" value={metrics.teams.total} />
                            <MetricCard title="Vault-linked teams" value={metrics.teams.vaultLinked} />
                        </MetricGrid>
                        <div className="mt-1 p-4 rounded-2xl border border-violet-100 bg-violet-50/40">
                            <span className="text-[10px] uppercase font-semibold tracking-[0.14em] text-slate-500 mb-3 block">
                                Invitation funnel
                            </span>
                            <BreakdownList
                                items={[
                                    { label: "Sent", value: metrics.teams.invitesTotal, color: "#cbd5e1" },
                                    { label: "Accepted", value: metrics.teams.invitesAccepted, color: "#7c3aed" },
                                ]}
                            />
                        </div>
                    </AdminMetricsPanel>

                    {/* PANEL 8: System Health */}
                    <AdminMetricsPanel
                        title="System health & events"
                        icon={<Shield size={16} />}
                        status={metrics.system.rateLimitHits24h > 1000 ? "warning" : "healthy"}
                        className="lg:col-span-2"
                    >
                        <MetricGrid cols={2}>
                            <MetricCard
                                title="Rate-limit hits (24h)"
                                value={metrics.system.rateLimitHits24h}
                                colorClass={metrics.system.rateLimitHits24h > 1000 ? "text-amber-600" : "text-slate-700"}
                            />
                            <MetricCard title="Active monitors" value={metrics.system.activeMonitors} />
                            <MetricCard title="Active atlas sessions" value={metrics.system.activeAtlasSessions} />
                            <MetricCard
                                title="Foresight accuracy"
                                value={metrics.system.foresightAccuracy}
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
