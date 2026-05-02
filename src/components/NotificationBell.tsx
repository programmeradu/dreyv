"use client";

import React, { useEffect, useCallback, useMemo, useState } from "react";
import * as LucideIcons from "lucide-react";
import {
    Bell,
    BellOff,
    X,
    SlidersHorizontal,
    ArrowRight,
    Loader2,
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

// ─── Premium custom-rendered glyphs (replace stock Lucide marks) ─────
import glyphBrand from "@/assets/notif/glyph-brand.png";
import glyphPurchase from "@/assets/notif/glyph-purchase.png";
import glyphListing from "@/assets/notif/glyph-listing.png";
import glyphInstall from "@/assets/notif/glyph-install.png";
import glyphDelist from "@/assets/notif/glyph-delist.png";
import glyphAgent from "@/assets/notif/glyph-agent.png";
import glyphSecurity from "@/assets/notif/glyph-security.png";
import glyphSystem from "@/assets/notif/glyph-system.png";

// ─── Type meta ────────────────────────────────────────────────────────
// Each type uses a custom-rendered crystal glyph + soft-tinted medallion.

type TypeMeta = {
    label: string;
    glyph: any; // StaticImageData from next/image
    medallionBg: string;
};

const TYPE_META: Record<NotificationType, TypeMeta> = {
    purchase: {
        label: "Purchase",
        glyph: glyphPurchase,
        medallionBg: "bg-emerald-50 ring-1 ring-emerald-100",
    },
    listing: {
        label: "Listing",
        glyph: glyphListing,
        medallionBg: "bg-sky-50 ring-1 ring-sky-100",
    },
    install: {
        label: "Install",
        glyph: glyphInstall,
        medallionBg: "bg-indigo-50 ring-1 ring-indigo-100",
    },
    delist: {
        label: "Delist",
        glyph: glyphDelist,
        medallionBg: "bg-amber-50 ring-1 ring-amber-100",
    },
    agent_alert: {
        label: "Agent",
        glyph: glyphAgent,
        medallionBg: "bg-violet-50 ring-1 ring-violet-100",
    },
    security: {
        label: "Security",
        glyph: glyphSecurity,
        medallionBg: "bg-rose-50 ring-1 ring-rose-100",
    },
    system: {
        label: "System",
        glyph: glyphSystem,
        medallionBg: "bg-slate-50 ring-1 ring-slate-100",
    },
};

// ─── Action button ────────────────────────────────────────────────────

import type { NotificationAction, NotificationActionContext } from "@/lib/notifications";

const VARIANT_CLASS: Record<Required<NotificationAction>["variant"], string> = {
    primary: "bg-violet-600 text-white hover:bg-violet-700 shadow-sm shadow-violet-600/20",
    ghost: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600/20",
};

function ActionButton({
    action,
    ctx,
}: {
    action: NotificationAction;
    ctx: NotificationActionContext;
}) {
    const [busy, setBusy] = useState(false);
    const variant = action.variant ?? "primary";
    // Resolve optional Lucide icon by name
    const IconCmp =
        action.icon && (LucideIcons as Record<string, any>)[action.icon]
            ? ((LucideIcons as Record<string, any>)[action.icon] as React.ComponentType<{
                  size?: number;
                  className?: string;
              }>)
            : null;

    const handleClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy || action.disabled) return;

        const markReadOnAction = action.markReadOnAction ?? true;
        const dismissOnAction = action.dismissOnAction ?? false;
        const closePopupOnAction = action.closePopupOnAction ?? true;

        try {
            setBusy(true);
            if (action.href) {
                ctx.navigate(action.href);
            } else if (action.onClick) {
                await action.onClick(ctx);
            }
            if (markReadOnAction) ctx.markRead();
            if (dismissOnAction) ctx.dismiss();
            if (closePopupOnAction) ctx.closePopup();
        } catch (err) {
            console.error("[NotificationAction]", action.label, err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={busy || action.disabled}
            title={action.tooltip ?? action.label}
            className={`inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed ${VARIANT_CLASS[variant]}`}
        >
            {busy ? (
                <Loader2 size={12} className="animate-spin" />
            ) : IconCmp ? (
                <IconCmp size={12} />
            ) : null}
            {action.label}
        </button>
    );
}

// ─── Item row ─────────────────────────────────────────────────────────

function NotificationItem({
    item,
    onRead,
    onRemove,
    onClosePopup,
}: {
    item: Notification;
    onRead: () => void;
    onRemove: () => void;
    onClosePopup: () => void;
}) {
    const unread = !item.read;
    const meta = TYPE_META[item.type] ?? TYPE_META.system;
    const avatarUrl: string | undefined = item.meta?.avatarUrl;
    const glyphSrc = typeof meta.glyph === "string" ? meta.glyph : (meta.glyph as any).src;

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

    const actions = (item.meta?.actions ?? []) as NotificationAction[];

    const ctx: NotificationActionContext = {
        dismiss: onRemove,
        markRead: onRead,
        closePopup: onClosePopup,
        navigate: (href: string) => {
            if (typeof window !== "undefined") window.location.href = href;
        },
    };

    return (
        <div
            className={`group relative flex items-start gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-slate-50/70 ${
                unread ? "bg-violet-50/30" : "bg-white"
            }`}
        >
            {/* Left violet accent bar for unread */}
            {unread && (
                <span
                    aria-hidden
                    className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-r-full bg-violet-600"
                />
            )}

            {/* Square medallion with custom crystal glyph */}
            <div
                className={`relative size-8 rounded-lg ${meta.medallionBg} flex items-center justify-center shrink-0 overflow-hidden`}
            >
                {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" className="size-full object-cover rounded-lg" />
                ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={glyphSrc}
                        alt=""
                        aria-hidden
                        className="size-5 object-contain drop-shadow-sm"
                        loading="lazy"
                    />
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            onRead();
                            if (item.href) {
                                onClosePopup();
                                window.location.href = item.href;
                            }
                        }}
                        className="flex-1 min-w-0 text-left"
                    >
                        <p className="text-[12.5px] font-semibold text-slate-900 leading-snug truncate">
                            {item.title}
                        </p>
                    </button>
                    <span className="text-[10.5px] text-slate-500 font-medium shrink-0 tabular-nums pt-0.5">
                        {time}
                    </span>
                </div>

                {item.message && (
                    <p className="text-[11.5px] text-slate-600 leading-snug mt-0.5 line-clamp-2">
                        {item.message}
                    </p>
                )}

                {actions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                        {actions.map((a, i) => (
                            <ActionButton key={a.id ?? `${a.label}-${i}`} action={a} ctx={ctx} />
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
                sideOffset={8}
                collisionPadding={12}
                className="w-[calc(100vw-24px)] sm:w-[340px] max-w-[340px] p-0 max-h-[70vh] sm:max-h-[460px] flex flex-col overflow-hidden rounded-xl border border-slate-200 shadow-[0_18px_50px_-18px_rgba(15,23,42,0.22)] bg-white"
            >
                {/* ─── Counter row + actions ──────────────────────────── */}
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-100 bg-white shrink-0">
                    <p className="text-[11.5px] font-semibold text-violet-600">
                        {count > 0
                            ? `${count} New Update${count === 1 ? "" : "s"}`
                            : `${visible.length} Notification${visible.length === 1 ? "" : "s"}`}
                    </p>
                    <div className="flex items-center gap-0.5 shrink-0">
                        {count > 0 && (
                            <button
                                onClick={markAllRead}
                                type="button"
                                className="text-[10px] font-bold tracking-[0.06em] uppercase text-slate-700 hover:text-violet-600 transition-colors px-1.5"
                            >
                                Mark all read
                            </button>
                        )}
                        <a
                            href="/app/settings"
                            onClick={() => setOpen(false)}
                            className="size-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            title="Notification settings"
                        >
                            <SlidersHorizontal size={13} />
                        </a>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="size-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            title="Close"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>

                {/* ─── List ───────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-slate-100">
                    {visible.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
                            <div className="size-14 rounded-2xl bg-violet-50 ring-1 ring-violet-100 flex items-center justify-center overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={typeof glyphBrand === "string" ? glyphBrand : (glyphBrand as any).src}
                                    alt=""
                                    aria-hidden
                                    className="size-9 object-contain opacity-80"
                                />
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
                                onClosePopup={() => setOpen(false)}
                            />
                        ))
                    )}
                </div>

                {/* ─── Footer ─────────────────────────────────────────── */}
                <div className="border-t border-slate-100 shrink-0 bg-slate-50/50">
                    <a
                        href="/app/inbox"
                        onClick={() => setOpen(false)}
                        className="group flex items-center justify-center gap-1.5 px-4 py-2.5 text-[11.5px] font-semibold text-slate-700 hover:text-violet-600 transition-colors"
                    >
                        See all notifications
                        <ArrowRight
                            size={12}
                            className="transition-transform group-hover:translate-x-0.5"
                        />
                    </a>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export { BellOff };
