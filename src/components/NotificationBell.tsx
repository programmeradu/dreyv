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
    Sparkle,
    Inbox,
    Filter,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
    useNotificationStore,
    notify,
    type Notification,
    type NotificationType,
} from "@/lib/notifications";
import { AppEventBus } from "@/lib/events";
import { formatDistanceToNow } from "date-fns";

// ─── Type meta ────────────────────────────────────────────────────────
// Each notification type gets a coordinated palette + icon for the
// medallion, the accent rail, and the unread dot. Colors come from
// existing tailwind utilities used elsewhere in the app for consistency.

type TypeMeta = {
    label: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    /** Tailwind text color class for the icon */
    iconClass: string;
    /** Tailwind bg class for the medallion (subtle tint) */
    medallionBg: string;
    /** Tailwind border class for the medallion */
    medallionRing: string;
    /** Tailwind bg class for the left accent rail when unread */
    rail: string;
};

const TYPE_META: Record<NotificationType, TypeMeta> = {
    purchase: {
        label: "Purchase",
        Icon: ShoppingCart,
        iconClass: "text-emerald-400",
        medallionBg: "bg-emerald-500/10",
        medallionRing: "ring-emerald-500/20",
        rail: "bg-emerald-400",
    },
    listing: {
        label: "Listing",
        Icon: Store,
        iconClass: "text-primary",
        medallionBg: "bg-primary/10",
        medallionRing: "ring-primary/20",
        rail: "bg-primary",
    },
    install: {
        label: "Install",
        Icon: Download,
        iconClass: "text-sky-400",
        medallionBg: "bg-sky-500/10",
        medallionRing: "ring-sky-500/20",
        rail: "bg-sky-400",
    },
    delist: {
        label: "Delist",
        Icon: X,
        iconClass: "text-amber-400",
        medallionBg: "bg-amber-500/10",
        medallionRing: "ring-amber-500/20",
        rail: "bg-amber-400",
    },
    agent_alert: {
        label: "Agent",
        Icon: Cpu,
        iconClass: "text-violet-400",
        medallionBg: "bg-violet-500/10",
        medallionRing: "ring-violet-500/20",
        rail: "bg-violet-400",
    },
    security: {
        label: "Security",
        Icon: Shield,
        iconClass: "text-red-400",
        medallionBg: "bg-red-500/10",
        medallionRing: "ring-red-500/20",
        rail: "bg-red-400",
    },
    system: {
        label: "System",
        Icon: AlertTriangle,
        iconClass: "text-muted-foreground",
        medallionBg: "bg-muted/40",
        medallionRing: "ring-border",
        rail: "bg-muted-foreground/60",
    },
};

// ─── Filters ──────────────────────────────────────────────────────────

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
            <div className="flex items-center gap-2 mb-0.5">
                <span
                    className={`text-[8px] font-black uppercase tracking-[0.14em] ${meta.iconClass}`}
                >
                    {meta.label}
                </span>
                {unread && (
                    <span className="size-1 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
                )}
            </div>
            <p
                className={`text-[12px] font-bold leading-tight truncate ${
                    unread ? "text-foreground" : "text-muted-foreground"
                }`}
            >
                {item.title}
            </p>
            <p className="text-[11px] text-muted-foreground/90 leading-snug line-clamp-2 mt-0.5">
                {item.message}
            </p>
            <p className="text-[9px] text-muted-foreground/50 mt-1.5 font-mono uppercase tracking-wider">
                {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
            </p>
        </div>
    );

    return (
        <div
            className={`group relative flex items-start gap-3 p-3 pl-4 rounded-xl border transition-all ${
                unread
                    ? "bg-card hover:bg-muted/30 border-border/60"
                    : "bg-transparent hover:bg-muted/20 border-transparent"
            }`}
        >
            {/* Accent rail */}
            <span
                aria-hidden
                className={`absolute left-1 top-3 bottom-3 w-[2px] rounded-full transition-opacity ${
                    meta.rail
                } ${unread ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`}
            />

            {/* Medallion icon */}
            <div
                className={`shrink-0 size-8 rounded-lg flex items-center justify-center ring-1 ${meta.medallionBg} ${meta.medallionRing}`}
            >
                <Icon size={14} className={meta.iconClass} />
            </div>

            {/* Body (link or click target) */}
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

            {/* Hover actions */}
            <div className="shrink-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {unread && (
                    <button
                        onClick={onRead}
                        className="text-muted-foreground hover:text-primary transition-colors p-1 rounded-md hover:bg-primary/10"
                        title="Mark as read"
                        type="button"
                    >
                        <Check size={11} />
                    </button>
                )}
                <button
                    onClick={onRemove}
                    className="text-muted-foreground hover:text-red-400 transition-colors p-1 rounded-md hover:bg-red-500/10"
                    title="Dismiss"
                    type="button"
                >
                    <Trash2 size={11} />
                </button>
            </div>
        </div>
    );
}

// ─── Bell ─────────────────────────────────────────────────────────────

export function NotificationBell() {
    const { notifications, markRead, markAllRead, remove, clearAll, unreadCount } =
        useNotificationStore();
    const count = unreadCount();
    const [filter, setFilter] = useState<FilterTab>("all");

    // Subscribe to AppEventBus UI_NOTIFICATION events and route them into the store
    const handleAppEvent = useCallback((event: { type: string; payload?: any }) => {
        if (event.type === "UI_NOTIFICATION" && event.payload?.message) {
            notify.agentAlert(event.payload.message);
        }
    }, []);

    useEffect(() => {
        return AppEventBus.subscribe(handleAppEvent);
    }, [handleAppEvent]);

    // Newest first + filter
    const visible = useMemo(() => {
        const sorted = [...notifications].reverse();
        return filter === "unread" ? sorted.filter((n) => !n.read) : sorted;
    }, [notifications, filter]);

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
                            {/* Soft glow */}
                            <span
                                aria-hidden
                                className="absolute -top-1 -right-1 size-[20px] rounded-full bg-primary/30 blur-md"
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
                sideOffset={8}
                className="w-[400px] p-0 max-h-[560px] flex flex-col overflow-hidden border-border/80 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]"
            >
                {/* ─── Header ─────────────────────────────────────────── */}
                <div className="relative px-4 pt-4 pb-3 border-b border-border/60 shrink-0 bg-gradient-to-b from-muted/30 to-transparent">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className="size-7 rounded-lg bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center">
                                <Sparkle
                                    size={13}
                                    className="text-primary"
                                    fill="currentColor"
                                />
                            </div>
                            <div>
                                <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-foreground leading-none">
                                    Inbox
                                </h3>
                                <p className="text-[9px] text-muted-foreground mt-1 font-mono uppercase tracking-wider">
                                    {count > 0 ? `${count} unread signal${count === 1 ? "" : "s"}` : "All caught up"}
                                </p>
                            </div>
                        </div>

                        <a
                            href="/app/settings"
                            className="size-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Notification settings"
                        >
                            <Settings2 size={13} />
                        </a>
                    </div>

                    {/* Filter tabs + actions */}
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/40 ring-1 ring-border/60">
                            {(["all", "unread"] as FilterTab[]).map((tab) => {
                                const active = filter === tab;
                                const tabCount =
                                    tab === "unread" ? count : notifications.length;
                                return (
                                    <button
                                        key={tab}
                                        onClick={() => setFilter(tab)}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${
                                            active
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground"
                                        }`}
                                        type="button"
                                    >
                                        {tab === "unread" && <Filter size={9} />}
                                        {tab}
                                        {tabCount > 0 && (
                                            <span
                                                className={`text-[8px] font-black px-1 rounded-full ${
                                                    active
                                                        ? "bg-primary/15 text-primary"
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

                        <div className="flex items-center gap-0.5">
                            {count > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={markAllRead}
                                    className="h-6 px-2 text-[9px] font-black uppercase tracking-wider text-muted-foreground hover:text-foreground"
                                >
                                    <Check size={9} className="mr-1" /> Read all
                                </Button>
                            )}
                            {notifications.length > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearAll}
                                    className="h-6 px-2 text-[9px] font-black uppercase tracking-wider text-muted-foreground hover:text-red-400"
                                >
                                    Clear
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* ─── List ───────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                    {visible.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
                            <div className="relative">
                                <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" />
                                <div className="relative size-12 rounded-2xl bg-muted/40 ring-1 ring-border flex items-center justify-center">
                                    {filter === "unread" ? (
                                        <Check size={20} className="text-primary" />
                                    ) : (
                                        <Inbox size={20} className="text-muted-foreground" />
                                    )}
                                </div>
                            </div>
                            <div>
                                <p className="text-xs font-black uppercase tracking-wider text-foreground">
                                    {filter === "unread" ? "Inbox zero" : "No signals yet"}
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-1 max-w-[220px]">
                                    {filter === "unread"
                                        ? "You've cleared every unread alert. Nice work."
                                        : "Agent activity, purchases, and security alerts will surface here."}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {visible.map((item) => (
                                <NotificationItem
                                    key={item.id}
                                    item={item}
                                    onRead={() => markRead(item.id)}
                                    onRemove={() => remove(item.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* ─── Footer ─────────────────────────────────────────── */}
                <div className="border-t border-border/60 px-4 py-2.5 shrink-0 bg-muted/20 flex items-center justify-between">
                    <a
                        href="/app/settings"
                        className="text-[9px] text-muted-foreground hover:text-primary transition-colors font-black uppercase tracking-[0.16em] flex items-center gap-1.5"
                    >
                        <Settings2 size={10} />
                        Preferences
                    </a>
                    <span className="text-[9px] text-muted-foreground/60 font-mono uppercase tracking-wider">
                        {notifications.length} total
                    </span>
                </div>
            </PopoverContent>
        </Popover>
    );
}

// Re-export BellOff to silence unused import warning if tree-shaken
export { BellOff };
