"use client";

import React from "react";
import { Bell, ShieldAlert, ShoppingCart, Store, Cpu, Mail, Trash2 } from "lucide-react";
import { useNotificationStore, type NotificationPreferences } from "@/lib/notifications";
import { formatDistanceToNow } from "date-fns";
import { ExternalChannelsPanel } from "./ExternalChannelsPanel";
import { DreyvStar } from "@/components/studio/DreyvStar";

const TOGGLES: { key: keyof NotificationPreferences; icon: any; title: string; desc: string; tone: string }[] = [
    {
        key: "security",
        icon: ShieldAlert,
        title: "Critical security alerts",
        desc: "Immediate alerts for multisig threshold breaches or suspicious contract interactions.",
        tone: "text-rose-600 bg-rose-50 ring-rose-100",
    },
    {
        key: "purchases",
        icon: ShoppingCart,
        title: "Purchases & installs",
        desc: "Notifications when you purchase or install an app from the Marketplace.",
        tone: "text-emerald-600 bg-emerald-50 ring-emerald-100",
    },
    {
        key: "listings",
        icon: Store,
        title: "Listing activity",
        desc: "Alerts when your apps are listed, updated, or delisted from the Marketplace.",
        tone: "text-sky-600 bg-sky-50 ring-sky-100",
    },
    {
        key: "agentAlerts",
        icon: Cpu,
        title: "Agent alerts",
        desc: "Real-time status of agent-led autonomous trades and proactive monitoring triggers.",
        tone: "text-violet-600 bg-violet-50 ring-violet-100",
    },
    {
        key: "system",
        icon: Bell,
        title: "System notifications",
        desc: "General platform updates, maintenance windows, and new features.",
        tone: "text-slate-700 bg-slate-50 ring-slate-100",
    },
];

export const NotificationsView = () => {
    const { notifications, preferences, setPreference, clearAll, activeWallet } = useNotificationStore();
    const recentNotifs = [...notifications].reverse().slice(0, 10);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="rounded-3xl border border-violet-100 bg-white p-6 sm:p-7">
                <header className="flex items-start gap-4 mb-6">
                    <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600 ring-1 ring-violet-100">
                        <Bell size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] tracking-[0.24em] uppercase font-semibold text-violet-700">Signals</p>
                        <h2 className="mt-1 text-[20px] sm:text-[22px] font-semibold tracking-[-0.01em] text-slate-900">
                            Alert sensitivity
                        </h2>
                        <p className="mt-1 text-[13px] text-slate-500">
                            History is scoped per wallet — switching accounts shows only that wallet's signals.
                        </p>
                    </div>
                </header>

                <div className="divide-y divide-violet-100">
                    {TOGGLES.map(({ key, icon: Icon, title, desc, tone }) => (
                        <div key={key} className="py-4 flex items-start gap-4">
                            <div className={`h-9 w-9 rounded-xl flex items-center justify-center ring-1 shrink-0 ${tone}`}>
                                <Icon size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="text-[14px] font-semibold text-slate-900">{title}</h3>
                                        <p className="mt-0.5 text-[12px] text-slate-500 leading-relaxed">{desc}</p>
                                    </div>
                                    <button
                                        onClick={() => setPreference(key, !preferences[key])}
                                        className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${preferences[key] ? "bg-violet-600" : "bg-slate-200"}`}
                                        aria-label={`Toggle ${title}`}
                                    >
                                        <span
                                            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${preferences[key] ? "translate-x-4" : "translate-x-0"}`}
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="rounded-3xl border border-violet-100 bg-white p-6 sm:p-7">
                <header className="flex items-center gap-3 mb-4">
                    <Mail className="text-violet-600" size={16} />
                    <h3 className="text-[14px] font-semibold text-slate-900">Delivery channels</h3>
                </header>
                <ExternalChannelsPanel />
                <div className="mt-4 flex items-center justify-between rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/40 px-4 py-3">
                    <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center text-violet-600 ring-1 ring-violet-100">
                            <Mail size={14} />
                        </div>
                        <div>
                            <p className="text-[13px] font-semibold text-slate-900">Email digest</p>
                            <p className="text-[11px] text-slate-500">Daily summary of signals</p>
                        </div>
                    </div>
                    <span className="h-2 w-2 rounded-full bg-violet-600 shadow-[0_0_10px_rgba(124,58,237,0.6)]" />
                </div>
            </section>

            <section className="rounded-3xl border border-violet-100 bg-white p-6 sm:p-7">
                <header className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                        <DreyvStar size={10} className="text-violet-600" />
                        <h3 className="text-[14px] font-semibold text-slate-900">Recent history</h3>
                        {activeWallet && (
                            <span className="text-[10px] tracking-[0.18em] uppercase font-semibold text-slate-400">
                                · {activeWallet.slice(0, 4)}…{activeWallet.slice(-4)}
                            </span>
                        )}
                    </div>
                    {notifications.length > 0 && (
                        <button
                            onClick={clearAll}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition"
                        >
                            <Trash2 size={11} /> Clear all
                        </button>
                    )}
                </header>
                {recentNotifs.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-violet-100 px-6 py-10 text-center">
                        <p className="text-[12px] text-slate-500">
                            No signals yet for this wallet. Purchases, listings, and agent activity will appear here.
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-violet-50">
                        {recentNotifs.map((n) => (
                            <li key={n.id} className={`py-3 flex items-start gap-3 ${n.read ? "opacity-60" : ""}`}>
                                <span
                                    className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-600 shrink-0"
                                    style={{ opacity: n.read ? 0 : 1 }}
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-semibold text-slate-900 truncate">{n.title}</p>
                                    <p className="text-[11px] text-slate-500 truncate">{n.message}</p>
                                </div>
                                <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                                    {formatDistanceToNow(new Date(n.timestamp), { addSuffix: true })}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
};
