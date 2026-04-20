"use client";

import React, { useEffect, useCallback, useMemo, useState } from "react";
import {
    Bell,
    BellOff,
    Check,
    X,
    ShoppingCart,
    Tag,
    Calendar,
    Smartphone,
    Cpu,
    Shield,
    Download,
    Settings2,
    Inbox,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    useNotificationStore,
    notify,
    type Notification,
    type NotificationType,
} from "@/lib/notifications";
import { AppEventBus } from "@/lib/events";
import { formatDistanceToNowStrict } from "date-fns";

// ─── Type meta ────────────────────────────────────────────────────────
// Soft pastel medallions inspired by clean light dashboards.
// Each pair works in both light and dark themes (low-opacity tints).

type TypeMeta = {
    label: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    iconClass: string;
    medallionBg: string;
};

const TYPE_META: Record<NotificationType, TypeMeta> = {
    purchase: {
        label: "Purchase",
        Icon: ShoppingCart,
        iconClass: "text-emerald-600 dark:text-emerald-300",
        medallionBg: "bg-emerald-100/80 dark:bg-emerald-500/10",
    },
    listing: {
        label: "Listing",
        Icon: Tag,
        iconClass: "text-sky-600 dark:text-sky-300",
        medallionBg: "bg-sky-100/80 dark:bg-sky-500/10",
    },
    install: {
        label: "Install",
        Icon: Download,
        iconClass: "text-indigo-600 dark:text-indigo-300",
        medallionBg: "bg-indigo-100/80 dark:bg-indigo-500/10",
    },
    delist: {
        label: "Delist",
        Icon: Smartphone,
        iconClass: "text-amber-600 dark:text-amber-300",
        medallionBg: "bg-amber-100/80 dark:bg-amber-500/10",
    },
    agent_alert: {
        label: "Agent",
        Icon: Cpu,
        iconClass: "text-violet-600 dark:text-violet-300",
        medallionBg: "bg-violet-100/80 dark:bg-violet-500/10",
    },
    security: {
        label: "Security",
        Icon: Shield,
        iconClass: "text-rose-600 dark:text-rose-300",
        medallionBg: "bg-rose-100/80 dark:bg-rose-500/10",
    },
    system: {
        label: "System",
        Icon: Calendar,
        iconClass: "text-muted-foreground",
        medallionBg: "bg-muted",
    },
};

type FilterTab = "all" | "unread";

// ─── Avatar / Medallion ───────────────────────────────────────────────

function Avatar({ item }: { item: Notification }) {
    const meta = TYPE_META[item.type] ?? TYPE_META.system;
    const { Icon } = meta;
    const avatarUrl: string | undefined = item.meta?.avatarUrl;
    const initials: string | undefined = item.meta?.initials;

    if (avatarUrl) {
        return (
            <div className="relative size-9 rounded-full overflow-hidden ring-1 ring-border/60 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatarUrl} alt="" className="size-full object-cover" />
            </div>
        );
    }
    if (initials) {
        return (
            <div
                className={`relative size-9 rounded-full ${meta.medallionBg} ${meta.iconClass} flex items-center justify-center text-[11px] font-semibold shrink-0`}
            >
                {initials.slice(0, 2).toUpperCase()}
            </div>
        );
    }
    return (
        <div
            className={`relative size-9 rounded-full ${meta.medallionBg} flex items-center justify-center shrink-0`}
        >
            <Icon size={16} className={meta.iconClass} />
        </div>
    );
}

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
    const unread = !item.read;
    const time = formatDistanceToNowStrict(new Date(item.timestamp), { addSuffix: false })
        .replace(" minutes", "m")
        .replace(" minute", "m")
        .replace(" hours", "h")
        .replace(" hour", "h")
        .replace(" days", "d")
        .replace(" day", "d")
        .replace(" seconds", "s")
        .replace(" second", "s")
        .replace(" months", "mo")
        .replace(" month", "mo")
        .replace(" years", "y")
        .replace(" year", "y")
        .replace(/\s+/g, "");

    const actions = (item.meta?.actions ?? []) as Array<{
        label: string;
        variant?: "primary" | "ghost";
        onClick: (ctx: { dismiss: () => void; markRead: () => void }) => void | Promise<void>;
    }>;

    const Inner = (
        <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
                <p
                    className={`flex-1 min-w-0 text-[13px] leading-snug ${
                        unread ? "text-foreground font-semibold" : "text-foreground/90 font-medium"
                    }`}
                >
                    {item.title}
                </p>
                <span className="text-[11px] text-muted-foreground/80 font-normal shrink-0 tabular-nums">
                    {time}
                </span>
            </div>
            {item.message && (
                <p className="text-[12.5px] text-muted-foreground leading-snug line-clamp-2 mt-0.5">
                    {item.message}
                </p>
            )}
            {actions.length > 0 && (
                <div className="flex items-center gap-2 mt-2.5">
                    {actions.map((a, i) => (
                        <button
                            key={i}
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void a.onClick({ dismiss: onRemove, markRead: onRead });
                            }}
                            className={`text-[11.5px] font-semibold px-3 py-1 rounded-full transition-colors ${
                                a.variant === "ghost"
                                    ? "border border-border text-foreground hover:bg-muted"
                                    : "bg-primary text-primary-foreground hover:opacity-90"
                            }`}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div
            className={`group relative flex items-start gap-3 px-4 py-3 transition-colors ${
                unread ? "bg-primary/[0.04]" : "bg-transparent"
            } hover:bg-muted/40`}
        >
            <Avatar item={item} />

            {item.href ? (
                <a
                    href={item.href}
                    onClick={onRead}
                    className="flex-1 min-w-0"
                >
                    {Inner}
                </a>
            ) : (
                <button
                    onClick={onRead}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                    type="button"
                >
                    {Inner}
                </button>
            )}

            {/* Unread dot */}
            {unread && (
                <span
                    aria-hidden
                    className="absolute right-3 top-3.5 size-2 rounded-full bg-primary"
                />
            )}

            {/* Hover dismiss */}
            <button
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove();
                }}
                className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                title="Dismiss"
                type="button"
            >
                <X size={12} />
            </button>
        </div>
    );
}

// ─── Bell ─────────────────────────────────────────────────────────────

export function NotificationBell() {
    const { notifications, markRead, markAllRead, remove, unreadCount } =
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

    const tabs: { key: FilterTab; label: string; count: number }[] = [
        { key: "all", label: "View All", count: notifications.length },
        { key: "unread", label: "Unread", count },
    ];

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
                >
                    <Bell size={18} />
                    {count > 0 && (
                        <span className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-background" />
                    )}
                </button>
            </PopoverTrigger>

            <PopoverContent
                align="end"
                sideOffset={10}
                className="w-[380px] p-0 max-h-[560px] flex flex-col overflow-hidden rounded-2xl border border-border/70 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.25)] dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] bg-popover"
            >
                {/* ─── Header ─────────────────────────────────────────── */}
                <div className="px-5 pt-4 pb-2 shrink-0">
                    <div className="flex items-center justify-between">
                        <h3 className="text-[17px] font-semibold tracking-tight text-foreground">
                            Notifications
                        </h3>
                        <a
                            href="/app/settings"
                            className="size-8 -mr-1.5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Notification settings"
                        >
                            <Settings2 size={15} />
                        </a>
                    </div>

                    {/* Tabs row */}
                    <div className="flex items-center justify-between gap-2 mt-3">
                        <div className="flex items-center gap-4">
                            {tabs.map((t) => {
                                const active = filter === t.key;
                                return (
                                    <button
                                        key={t.key}
                                        onClick={() => setFilter(t.key)}
                                        type="button"
                                        className={`relative pb-2 text-[12.5px] font-medium transition-colors flex items-center gap-1.5 ${
                                            active
                                                ? "text-foreground"
                                                : "text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {t.label}
                                        {t.count > 0 && (
                                            <span
                                                className={`text-[10.5px] font-semibold px-1.5 py-px rounded-full leading-none ${
                                                    active
                                                        ? "bg-primary text-primary-foreground"
                                                        : "bg-muted text-muted-foreground"
                                                }`}
                                            >
                                                {t.count > 99 ? "99+" : t.count}
                                            </span>
                                        )}
                                        {active && (
                                            <span
                                                aria-hidden
                                                className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-foreground"
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        {count > 0 && (
                            <button
                                onClick={markAllRead}
                                type="button"
                                className="text-[12px] font-medium text-primary hover:opacity-80 transition-opacity"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>
                    <div className="h-px bg-border/70 -mx-5" />
                </div>

                {/* ─── List ───────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-border/50">
                    {visible.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
                            <div className="size-12 rounded-full bg-muted flex items-center justify-center">
                                {filter === "unread" ? (
                                    <Check size={20} className="text-muted-foreground" />
                                ) : (
                                    <Inbox size={20} className="text-muted-foreground" />
                                )}
                            </div>
                            <div>
                                <p className="text-[13px] font-semibold text-foreground">
                                    {filter === "unread" ? "You're all caught up" : "No notifications yet"}
                                </p>
                                <p className="text-[12px] text-muted-foreground mt-1 max-w-[240px] leading-relaxed">
                                    {filter === "unread"
                                        ? "Every signal has been read."
                                        : "Activity from your agents and the marketplace will show up here."}
                                </p>
                            </div>
                        </div>
                    ) : (
                        visible.map((item) => (
                            <NotificationItem
                                key={item.id}
                                item={item}
                                onRead={() => markRead(item.id)}
                                onRemove={() => remove(item.id)}
                            />
                        ))
                    )}
                </div>

                {/* ─── Footer ─────────────────────────────────────────── */}
                <div className="border-t border-border/70 shrink-0">
                    <a
                        href="/app/settings"
                        className="block px-5 py-3 text-center text-[12.5px] font-medium text-foreground hover:bg-muted/50 transition-colors"
                    >
                        See all notifications
                    </a>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export { BellOff };
