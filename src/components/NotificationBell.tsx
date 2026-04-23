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
    SlidersHorizontal,
    Inbox,
    ArrowRight,
    Network,
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
// Square, soft-tinted medallions inspired by the Stitch reference.

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
        iconClass: "text-emerald-600",
        medallionBg: "bg-emerald-50 ring-1 ring-emerald-100",
    },
    listing: {
        label: "Listing",
        Icon: Tag,
        iconClass: "text-sky-600",
        medallionBg: "bg-sky-50 ring-1 ring-sky-100",
    },
    install: {
        label: "Install",
        Icon: Download,
        iconClass: "text-indigo-600",
        medallionBg: "bg-indigo-50 ring-1 ring-indigo-100",
    },
    delist: {
        label: "Delist",
        Icon: Smartphone,
        iconClass: "text-amber-600",
        medallionBg: "bg-amber-50 ring-1 ring-amber-100",
    },
    agent_alert: {
        label: "Agent",
        Icon: Cpu,
        iconClass: "text-violet-600",
        medallionBg: "bg-violet-50 ring-1 ring-violet-100",
    },
    security: {
        label: "Security",
        Icon: Shield,
        iconClass: "text-rose-600",
        medallionBg: "bg-rose-50 ring-1 ring-rose-100",
    },
    system: {
        label: "System",
        Icon: Calendar,
        iconClass: "text-slate-600",
        medallionBg: "bg-slate-50 ring-1 ring-slate-100",
    },
};

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
    const meta = TYPE_META[item.type] ?? TYPE_META.system;
    const { Icon } = meta;
    const avatarUrl: string | undefined = item.meta?.avatarUrl;

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
        .replace(/\s+/g, "") + " ago";

    const actions = (item.meta?.actions ?? []) as Array<{
        label: string;
        variant?: "primary" | "ghost";
        onClick: (ctx: { dismiss: () => void; markRead: () => void }) => void | Promise<void>;
    }>;

    return (
        <div
            className={`group relative flex items-start gap-3 px-5 py-4 transition-colors hover:bg-slate-50/70 ${
                unread ? "bg-violet-50/30" : "bg-white"
            }`}
        >
            {/* Left violet accent bar for unread */}
            {unread && (
                <span
                    aria-hidden
                    className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-violet-600"
                />
            )}

            {/* Square medallion */}
            <div
                className={`relative size-10 rounded-xl ${meta.medallionBg} flex items-center justify-center shrink-0 overflow-hidden`}
            >
                {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" className="size-full object-cover rounded-xl" />
                ) : (
                    <Icon size={18} className={meta.iconClass} />
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                    <button
                        type="button"
                        onClick={onRead}
                        className="flex-1 min-w-0 text-left"
                    >
                        <p className="text-[13.5px] font-bold text-slate-900 leading-snug truncate">
                            {item.title}
                        </p>
                    </button>
                    <span className="text-[11.5px] text-slate-500 font-medium shrink-0 tabular-nums pt-0.5">
                        {time}
                    </span>
                </div>

                {item.message && (
                    <p className="text-[12.5px] text-slate-600 leading-snug mt-1 line-clamp-2">
                        {item.message}
                    </p>
                )}

                {actions.length > 0 && (
                    <div className="flex items-center gap-2 mt-3">
                        {actions.map((a, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void a.onClick({ dismiss: onRemove, markRead: onRead });
                                }}
                                className={`text-[12px] font-semibold px-3.5 py-1.5 rounded-lg transition-all ${
                                    a.variant === "ghost"
                                        ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                        : "bg-violet-600 text-white hover:bg-violet-700 shadow-sm shadow-violet-600/20"
                                }`}
                            >
                                {a.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Hover dismiss */}
            <button
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove();
                }}
                className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
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
    const [open, setOpen] = useState(false);

    const handleAppEvent = useCallback((event: { type: string; payload?: any }) => {
        if (event.type === "UI_NOTIFICATION" && event.payload?.message) {
            notify.agentAlert(event.payload.message);
        }
    }, []);

    useEffect(() => {
        return AppEventBus.subscribe(handleAppEvent);
    }, [handleAppEvent]);

    const visible = useMemo(() => [...notifications].reverse(), [notifications]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
                >
                    <Bell size={18} />
                    {count > 0 && (
                        <span className="absolute top-1 right-1 size-2 rounded-full bg-violet-600 ring-2 ring-background" />
                    )}
                </button>
            </PopoverTrigger>

            <PopoverContent
                align="end"
                sideOffset={10}
                className="w-[400px] p-0 max-h-[600px] flex flex-col overflow-hidden rounded-2xl border border-slate-200 shadow-[0_24px_70px_-20px_rgba(15,23,42,0.25)] bg-white"
            >
                {/* ─── Brand Header ───────────────────────────────────── */}
                <div className="px-5 pt-5 pb-4 shrink-0 border-b border-slate-100">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="size-11 rounded-xl bg-violet-100 ring-1 ring-violet-200 flex items-center justify-center shrink-0">
                                <Network size={20} className="text-violet-600" strokeWidth={2.25} />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-[16px] font-bold tracking-tight text-slate-900 leading-tight">
                                    Alpha Alert
                                </h3>
                                <p className="text-[10.5px] font-semibold tracking-[0.08em] uppercase text-slate-500 mt-0.5">
                                    Dreyv Atlas Intelligence
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <a
                                href="/app/settings"
                                onClick={() => setOpen(false)}
                                className="size-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                                title="Notification settings"
                            >
                                <SlidersHorizontal size={15} />
                            </a>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="size-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                                title="Close"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* ─── Counter row ────────────────────────────────────── */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-white shrink-0">
                    <p className="text-[12.5px] font-semibold text-violet-600">
                        {count > 0
                            ? `${count} New Update${count === 1 ? "" : "s"}`
                            : `${visible.length} Notification${visible.length === 1 ? "" : "s"}`}
                    </p>
                    {count > 0 && (
                        <button
                            onClick={markAllRead}
                            type="button"
                            className="text-[11px] font-bold tracking-[0.08em] uppercase text-slate-700 hover:text-violet-600 transition-colors"
                        >
                            Mark all as read
                        </button>
                    )}
                </div>

                {/* ─── List ───────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-slate-100">
                    {visible.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
                            <div className="size-12 rounded-xl bg-violet-50 ring-1 ring-violet-100 flex items-center justify-center">
                                <Inbox size={20} className="text-violet-600" />
                            </div>
                            <div>
                                <p className="text-[13px] font-bold text-slate-900">
                                    You're all caught up
                                </p>
                                <p className="text-[12px] text-slate-500 mt-1 max-w-[260px] leading-relaxed">
                                    Activity from your agents, watchers, and the marketplace will surface here.
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
                <div className="border-t border-slate-100 shrink-0 bg-slate-50/50">
                    <a
                        href="/app/inbox"
                        onClick={() => setOpen(false)}
                        className="group flex items-center justify-center gap-2 px-5 py-3.5 text-[12.5px] font-semibold text-slate-700 hover:text-violet-600 transition-colors"
                    >
                        See all notifications
                        <ArrowRight
                            size={14}
                            className="transition-transform group-hover:translate-x-0.5"
                        />
                    </a>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export { BellOff };
