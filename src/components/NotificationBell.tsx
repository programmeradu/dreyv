"use client";

import React, { useEffect, useCallback, useMemo, useState } from "react";
import {
    Bell,
    BellOff,
    Check,
    Trash2,
    ShoppingCart,
    Store,
    Download,
    AlertTriangle,
    Shield,
    Cpu,
    X,
    Settings2,
    Sparkles,
    Inbox,
    Radio,
    ArrowUpRight,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    useNotificationStore,
    notify,
    type Notification,
    type NotificationType,
} from "@/lib/notifications";
import { AppEventBus } from "@/lib/events";
import { formatDistanceToNow, isToday, isYesterday } from "date-fns";

// ─── Type meta ────────────────────────────────────────────────────────

type TypeMeta = {
    label: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    iconClass: string;
    medallionBg: string;
    medallionRing: string;
    rail: string;
    /** raw HSL var for glow shadows */
    glowVar: string;
};

const TYPE_META: Record<NotificationType, TypeMeta> = {
    purchase: {
        label: "Purchase",
        Icon: ShoppingCart,
        iconClass: "text-emerald-300",
        medallionBg: "bg-emerald-500/10",
        medallionRing: "ring-emerald-400/25",
        rail: "from-emerald-400/0 via-emerald-400 to-emerald-400/0",
        glowVar: "16 185 129",
    },
    listing: {
        label: "Listing",
        Icon: Store,
        iconClass: "text-primary",
        medallionBg: "bg-primary/10",
        medallionRing: "ring-primary/25",
        rail: "from-primary/0 via-primary to-primary/0",
        glowVar: "139 92 246",
    },
    install: {
        label: "Install",
        Icon: Download,
        iconClass: "text-sky-300",
        medallionBg: "bg-sky-500/10",
        medallionRing: "ring-sky-400/25",
        rail: "from-sky-400/0 via-sky-400 to-sky-400/0",
        glowVar: "56 189 248",
    },
    delist: {
        label: "Delist",
        Icon: X,
        iconClass: "text-amber-300",
        medallionBg: "bg-amber-500/10",
        medallionRing: "ring-amber-400/25",
        rail: "from-amber-400/0 via-amber-400 to-amber-400/0",
        glowVar: "251 191 36",
    },
    agent_alert: {
        label: "Agent",
        Icon: Cpu,
        iconClass: "text-violet-300",
        medallionBg: "bg-violet-500/10",
        medallionRing: "ring-violet-400/25",
        rail: "from-violet-400/0 via-violet-400 to-violet-400/0",
        glowVar: "167 139 250",
    },
    security: {
        label: "Security",
        Icon: Shield,
        iconClass: "text-red-300",
        medallionBg: "bg-red-500/10",
        medallionRing: "ring-red-400/30",
        rail: "from-red-400/0 via-red-400 to-red-400/0",
        glowVar: "248 113 113",
    },
    system: {
        label: "System",
        Icon: AlertTriangle,
        iconClass: "text-muted-foreground",
        medallionBg: "bg-muted/40",
        medallionRing: "ring-border",
        rail: "from-transparent via-muted-foreground/60 to-transparent",
        glowVar: "148 163 184",
    },
};

type FilterTab = "all" | "unread";

// ─── Item row ─────────────────────────────────────────────────────────

function NotificationItem({
    item,
    onRead,
    onRemove,
}: {
    item: Notification;
    onRead: () => void;
    onRemove: () => void;
}) {
    const meta = TYPE_META[item.type] ?? TYPE_META.system;
    const { Icon } = meta;
    const unread = !item.read;

    const Body = (
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
                <span
                    className={`text-[8.5px] font-black uppercase tracking-[0.18em] ${meta.iconClass}`}
                >
                    {meta.label}
                </span>
                <span className="text-[8px] text-muted-foreground/40 font-mono">·</span>
                <span className="text-[8.5px] text-muted-foreground/70 font-mono uppercase tracking-wider truncate">
                    {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                </span>
                {item.href && (
                    <ArrowUpRight
                        size={10}
                        className="text-muted-foreground/40 ml-auto shrink-0"
                    />
                )}
            </div>
            <p
                className={`text-[12.5px] font-bold leading-tight tracking-tight ${
                    unread ? "text-foreground" : "text-muted-foreground"
                }`}
            >
                {item.title}
            </p>
            <p className="text-[11px] text-muted-foreground/80 leading-snug line-clamp-2 mt-0.5">
                {item.message}
            </p>
        </div>
    );

    return (
        <div
            className={`group relative flex items-start gap-3 pl-4 pr-2 py-3 rounded-xl border transition-all duration-200 ${
                unread
                    ? "bg-gradient-to-br from-card to-card/40 border-border/70 hover:border-border"
                    : "bg-transparent hover:bg-muted/15 border-transparent"
            }`}
        >
            {/* Vertical accent rail (gradient) */}
            <span
                aria-hidden
                className={`absolute left-1 top-3 bottom-3 w-[2px] rounded-full bg-gradient-to-b ${meta.rail} transition-opacity duration-300 ${
                    unread ? "opacity-100" : "opacity-0 group-hover:opacity-50"
                }`}
            />

            {/* Medallion with halo when unread */}
            <div className="relative shrink-0">
                {unread && (
                    <span
                        aria-hidden
                        className="absolute inset-0 rounded-xl blur-md opacity-60"
                        style={{ backgroundColor: `rgba(${meta.glowVar}, 0.35)` }}
                    />
                )}
                <div
                    className={`relative size-9 rounded-xl flex items-center justify-center ring-1 ${meta.medallionBg} ${meta.medallionRing} backdrop-blur-sm`}
                >
                    <Icon size={15} className={meta.iconClass} />
                </div>
            </div>

            {/* Body */}
            {item.href ? (
                <a
                    href={item.href}
                    onClick={onRead}
                    className="flex-1 min-w-0 hover:[&_p:first-of-type]:text-primary transition-colors"
                >
                    {Body}
                </a>
            ) : (
                <button
                    onClick={onRead}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                    type="button"
                >
                    {Body}
                </button>
            )}

            {/* Hover actions slide in from the right */}
            <div className="shrink-0 flex flex-col gap-1 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200">
                {unread && (
                    <button
                        onClick={onRead}
                        className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded-md hover:bg-primary/10"
                        title="Mark as read"
                        type="button"
                    >
                        <Check size={11} />
                    </button>
                )}
                <button
                    onClick={onRemove}
                    className="text-muted-foreground hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-500/10"
                    title="Dismiss"
                    type="button"
                >
                    <Trash2 size={11} />
                </button>
            </div>
        </div>
    );
}

// ─── Day grouping ─────────────────────────────────────────────────────

type Group = { label: string; items: Notification[] };

function groupByDay(items: Notification[]): Group[] {
    const today: Notification[] = [];
    const yesterday: Notification[] = [];
    const earlier: Notification[] = [];
    for (const n of items) {
        const d = new Date(n.timestamp);
        if (isToday(d)) today.push(n);
        else if (isYesterday(d)) yesterday.push(n);
        else earlier.push(n);
    }
    return [
        { label: "Today", items: today },
        { label: "Yesterday", items: yesterday },
        { label: "Earlier", items: earlier },
    ].filter((g) => g.items.length > 0);
}

// ─── Bell ─────────────────────────────────────────────────────────────

export function NotificationBell() {
    const { notifications, markRead, markAllRead, remove, clearAll, unreadCount } =
        useNotificationStore();
    const count = unreadCount();
    const [filter, setFilter] = useState<FilterTab>("all");

    const handleAppEvent = useCallback((event: { type: string; payload?: any }) => {
        if (event.type === "UI_NOTIFICATION" && event.payload?.message) {
            notify.agentAlert(event.payload.message);
        }
    }, []);

    useEffect(() => {
        return AppEventBus.subscribe(handleAppEvent);
    }, [handleAppEvent]);

    const visible = useMemo(() => {
        const sorted = [...notifications].reverse();
        return filter === "unread" ? sorted.filter((n) => !n.read) : sorted;
    }, [notifications, filter]);

    const groups = useMemo(() => groupByDay(visible), [visible]);

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
                >
                    <Bell size={18} />
                    {count > 0 && (
                        <>
                            <span
                                aria-hidden
                                className="absolute -top-1 -right-1 size-[20px] rounded-full bg-primary/40 blur-md animate-pulse"
                            />
                            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary flex items-center justify-center ring-2 ring-background">
                                <span className="text-[9px] font-black text-primary-foreground leading-none">
                                    {count > 99 ? "99+" : count}
                                </span>
                            </span>
                        </>
                    )}
                </button>
            </PopoverTrigger>

            <PopoverContent
                align="end"
                sideOffset={10}
                className="w-[420px] p-0 max-h-[600px] flex flex-col overflow-hidden border-border/70 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] rounded-2xl bg-card/95 backdrop-blur-xl"
            >
                {/* ─── Ambient header ─────────────────────────────────── */}
                <div className="relative shrink-0 overflow-hidden border-b border-border/50">
                    {/* Aurora background */}
                    <div
                        aria-hidden
                        className="absolute inset-0 opacity-70 pointer-events-none"
                        style={{
                            background:
                                "radial-gradient(120% 80% at 0% 0%, hsl(var(--primary)/0.18) 0%, transparent 55%), radial-gradient(80% 60% at 100% 0%, rgba(139,92,246,0.12) 0%, transparent 60%)",
                        }}
                    />
                    <div
                        aria-hidden
                        className="absolute -top-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
                    />

                    <div className="relative px-5 pt-4 pb-3">
                        <div className="flex items-center justify-between mb-3.5">
                            <div className="flex items-center gap-2.5">
                                <div className="relative">
                                    <div className="absolute inset-0 bg-primary/40 blur-md rounded-lg" />
                                    <div className="relative size-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/30 flex items-center justify-center">
                                        <Sparkles
                                            size={14}
                                            className="text-primary"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center gap-1.5">
                                        <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-foreground leading-none">
                                            Signal Inbox
                                        </h3>
                                        {count > 0 && (
                                            <span className="relative flex size-1.5">
                                                <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
                                                <span className="relative rounded-full size-1.5 bg-primary" />
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[9px] text-muted-foreground mt-1 font-mono uppercase tracking-[0.15em] flex items-center gap-1.5">
                                        <Radio size={9} className="text-primary/70" />
                                        {count > 0
                                            ? `${count} live signal${count === 1 ? "" : "s"}`
                                            : "All channels quiet"}
                                    </p>
                                </div>
                            </div>

                            <a
                                href="/app/settings"
                                className="size-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                                title="Notification settings"
                            >
                                <Settings2 size={13} />
                            </a>
                        </div>

                        {/* Filter segmented + actions */}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-background/60 ring-1 ring-border/60 backdrop-blur">
                                {(["all", "unread"] as FilterTab[]).map((tab) => {
                                    const active = filter === tab;
                                    const tabCount =
                                        tab === "unread" ? count : notifications.length;
                                    return (
                                        <button
                                            key={tab}
                                            onClick={() => setFilter(tab)}
                                            className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-[0.14em] transition-all ${
                                                active
                                                    ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]"
                                                    : "text-muted-foreground hover:text-foreground"
                                            }`}
                                            type="button"
                                        >
                                            {tab}
                                            {tabCount > 0 && (
                                                <span
                                                    className={`text-[8.5px] font-black px-1.5 py-px rounded-full leading-none ${
                                                        active
                                                            ? "bg-primary/25 text-primary"
                                                            : "bg-muted-foreground/15 text-muted-foreground"
                                                    }`}
                                                >
                                                    {tabCount > 99 ? "99+" : tabCount}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex items-center gap-2">
                                {count > 0 && (
                                    <button
                                        onClick={markAllRead}
                                        className="text-[9px] font-black uppercase tracking-[0.14em] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                                        type="button"
                                    >
                                        <Check size={10} />
                                        Read all
                                    </button>
                                )}
                                {notifications.length > 0 && (
                                    <button
                                        onClick={clearAll}
                                        className="text-[9px] font-black uppercase tracking-[0.14em] text-muted-foreground/70 hover:text-red-400 transition-colors"
                                        type="button"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ─── List ───────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                    {visible.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
                            <div className="relative">
                                <div className="absolute inset-0 bg-primary/30 blur-3xl rounded-full" />
                                <div
                                    aria-hidden
                                    className="absolute inset-[-12px] rounded-full border border-primary/15 animate-pulse"
                                />
                                <div
                                    aria-hidden
                                    className="absolute inset-[-24px] rounded-full border border-primary/10"
                                />
                                <div className="relative size-14 rounded-2xl bg-gradient-to-br from-card to-muted/40 ring-1 ring-border flex items-center justify-center">
                                    {filter === "unread" ? (
                                        <Check size={22} className="text-primary" />
                                    ) : (
                                        <Inbox size={22} className="text-muted-foreground" />
                                    )}
                                </div>
                            </div>
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-foreground">
                                    {filter === "unread" ? "Inbox zero" : "No signals yet"}
                                </p>
                                <p className="text-[10.5px] text-muted-foreground mt-1.5 max-w-[240px] leading-relaxed">
                                    {filter === "unread"
                                        ? "Every signal is read. Your agents are watching the rest."
                                        : "Agent activity, marketplace events, and security alerts will surface here in real time."}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="px-2 py-2 space-y-3">
                            {groups.map((group) => (
                                <div key={group.label} className="space-y-1">
                                    <div className="sticky top-0 z-10 px-3 py-1.5 backdrop-blur-md bg-card/80">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/80">
                                                {group.label}
                                            </span>
                                            <span className="flex-1 h-px bg-gradient-to-r from-border/60 to-transparent" />
                                            <span className="text-[8.5px] font-mono text-muted-foreground/50 uppercase tracking-wider">
                                                {group.items.length}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        {group.items.map((item) => (
                                            <NotificationItem
                                                key={item.id}
                                                item={item}
                                                onRead={() => markRead(item.id)}
                                                onRemove={() => remove(item.id)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ─── Footer ─────────────────────────────────────────── */}
                <div className="relative border-t border-border/50 px-4 py-2.5 shrink-0 bg-gradient-to-b from-transparent to-muted/10 flex items-center justify-between">
                    <a
                        href="/app/settings"
                        className="text-[9px] text-muted-foreground hover:text-primary transition-colors font-black uppercase tracking-[0.18em] flex items-center gap-1.5"
                    >
                        <Settings2 size={10} />
                        Preferences
                    </a>
                    <span className="text-[9px] text-muted-foreground/50 font-mono uppercase tracking-[0.15em]">
                        {notifications.length} total · synced
                    </span>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export { BellOff };
