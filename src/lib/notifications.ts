"use client";

import { create } from "zustand";

// ─── Types ───────────────────────────────────────────────────────────

export type NotificationType =
    | "purchase"
    | "listing"
    | "install"
    | "delist"
    | "agent_alert"
    | "security"
    | "system";

export interface NotificationActionContext {
    /** Remove this notification from the bell entirely. */
    dismiss: () => void;
    /** Mark this notification as read (keeps it in history). */
    markRead: () => void;
    /** Close the notification popup overlay. */
    closePopup: () => void;
    /** Programmatically navigate (uses window.location). */
    navigate: (href: string) => void;
}

export interface NotificationAction {
    /** Stable id for the action — used for loading/disabled state. Optional. */
    id?: string;
    label: string;
    /** Optional Lucide icon name (e.g. "TrendingUp"). Resolved at render time. */
    icon?: string;
    /** Visual variant. Defaults to "primary". */
    variant?: "primary" | "ghost" | "danger";
    /** If set, action navigates to this href instead of running onClick. */
    href?: string;
    /** Tooltip / aria-label override. */
    tooltip?: string;
    /**
     * Called when clicked. May be async — button shows a spinner until it resolves.
     * Throw to surface an error toast (caller wires this).
     */
    onClick?: (ctx: NotificationActionContext) => void | Promise<void>;
    /** Auto-mark as read after the action resolves. Default: true. */
    markReadOnAction?: boolean;
    /** Auto-dismiss (remove) after the action resolves. Default: false. */
    dismissOnAction?: boolean;
    /** Auto-close the popup after the action resolves. Default: true. */
    closePopupOnAction?: boolean;
    /** Disable the button (e.g. waiting on a precondition). */
    disabled?: boolean;
}

export interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    timestamp: number;
    read: boolean;
    href?: string;          // optional link to navigate to
    meta?: Record<string, any> & {
        avatarUrl?: string;
        initials?: string;
        actions?: NotificationAction[];
    };
}

export interface NotificationPreferences {
    purchases: boolean;
    listings: boolean;
    agentAlerts: boolean;
    security: boolean;
    system: boolean;
}

interface NotificationStore {
    notifications: Notification[];
    preferences: NotificationPreferences;
    /** Add a new notification (respects preferences) */
    addNotification: (n: Omit<Notification, "id" | "timestamp" | "read">) => void;
    /** Mark a single notification as read */
    markRead: (id: string) => void;
    /** Mark all notifications as read */
    markAllRead: () => void;
    /** Remove a single notification */
    remove: (id: string) => void;
    /** Clear all notifications */
    clearAll: () => void;
    /** Get unread count */
    unreadCount: () => number;
    /** Update a preference toggle */
    setPreference: (key: keyof NotificationPreferences, value: boolean) => void;
}

// ─── LocalStorage helpers ────────────────────────────────────────────

const LS_KEY = "keystone_notifications";
const LS_PREFS_KEY = "keystone_notification_prefs";
const MAX_NOTIFICATIONS = 100;

function loadNotifications(): Notification[] {
    if (typeof window === "undefined") return [];
    try {
        return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {
        return [];
    }
}

function saveNotifications(items: Notification[]) {
    if (typeof window === "undefined") return;
    // Keep only the most recent MAX_NOTIFICATIONS
    const trimmed = items.slice(-MAX_NOTIFICATIONS);
    localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
}

function loadPreferences(): NotificationPreferences {
    const defaults: NotificationPreferences = {
        purchases: true,
        listings: true,
        agentAlerts: true,
        security: true,
        system: true,
    };
    if (typeof window === "undefined") return defaults;
    try {
        const stored = JSON.parse(localStorage.getItem(LS_PREFS_KEY) || "{}");
        return { ...defaults, ...stored };
    } catch {
        return defaults;
    }
}

function savePreferences(prefs: NotificationPreferences) {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_PREFS_KEY, JSON.stringify(prefs));
}

// ─── Preference-to-type mapping ──────────────────────────────────────

function isAllowedByPreferences(type: NotificationType, prefs: NotificationPreferences): boolean {
    switch (type) {
        case "purchase":
        case "install":
            return prefs.purchases;
        case "listing":
        case "delist":
            return prefs.listings;
        case "agent_alert":
            return prefs.agentAlerts;
        case "security":
            return prefs.security;
        case "system":
            return prefs.system;
        default:
            return true;
    }
}

// ─── Zustand Store ───────────────────────────────────────────────────

export const useNotificationStore = create<NotificationStore>((set, get) => ({
    notifications: loadNotifications(),
    preferences: loadPreferences(),

    addNotification: (n) => {
        const prefs = get().preferences;
        if (!isAllowedByPreferences(n.type, prefs)) return;

        const item: Notification = {
            ...n,
            id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            read: false,
        };

        set((state) => {
            const updated = [...state.notifications, item].slice(-MAX_NOTIFICATIONS);
            saveNotifications(updated);
            return { notifications: updated };
        });
    },

    markRead: (id) => {
        set((state) => {
            const updated = state.notifications.map((n) =>
                n.id === id ? { ...n, read: true } : n
            );
            saveNotifications(updated);
            return { notifications: updated };
        });
    },

    markAllRead: () => {
        set((state) => {
            const updated = state.notifications.map((n) => ({ ...n, read: true }));
            saveNotifications(updated);
            return { notifications: updated };
        });
    },

    remove: (id) => {
        set((state) => {
            const updated = state.notifications.filter((n) => n.id !== id);
            saveNotifications(updated);
            return { notifications: updated };
        });
    },

    clearAll: () => {
        saveNotifications([]);
        set({ notifications: [] });
    },

    unreadCount: () => {
        return get().notifications.filter((n) => !n.read).length;
    },

    setPreference: (key, value) => {
        set((state) => {
            const updated = { ...state.preferences, [key]: value };
            savePreferences(updated);
            return { preferences: updated };
        });
    },
}));

// ─── Convenience emitters ────────────────────────────────────────────

export const notify = {
    purchase: (appName: string, price: number, txSignature?: string) => {
        useNotificationStore.getState().addNotification({
            type: "purchase",
            title: "Purchase Complete",
            message: price > 0
                ? `"${appName}" purchased for ${price} SOL`
                : `"${appName}" installed for free`,
            href: "/app/library",
            meta: txSignature ? { txSignature } : undefined,
        });
    },

    listing: (appName: string, price: number) => {
        useNotificationStore.getState().addNotification({
            type: "listing",
            title: "App Listed",
            message: price > 0
                ? `"${appName}" listed for ${price} SOL on Marketplace`
                : `"${appName}" listed as FREE on Marketplace`,
            href: "/app/marketplace",
        });
    },

    delist: (appName: string) => {
        useNotificationStore.getState().addNotification({
            type: "delist",
            title: "App Delisted",
            message: `"${appName}" removed from Marketplace`,
        });
    },

    install: (appName: string) => {
        useNotificationStore.getState().addNotification({
            type: "install",
            title: "App Installed",
            message: `"${appName}" added to your Library`,
            href: "/app/library",
        });
    },

    agentAlert: (message: string) => {
        useNotificationStore.getState().addNotification({
            type: "agent_alert",
            title: "Agent Alert",
            message,
            href: "/app",
        });
    },

    security: (message: string) => {
        useNotificationStore.getState().addNotification({
            type: "security",
            title: "Security Alert",
            message,
        });
    },

    system: (title: string, message: string) => {
        useNotificationStore.getState().addNotification({
            type: "system",
            title,
            message,
        });
    },

    // ─── Actionable notifications ────────────────────────────────────

    /** Team invite — renders Accept / Decline inline buttons. */
    teamInvite: (opts: {
        teamName: string;
        invitedBy?: string;
        avatarUrl?: string;
        onAccept: () => void | Promise<void>;
        onDecline: () => void | Promise<void>;
    }) => {
        useNotificationStore.getState().addNotification({
            type: "system",
            title: `${opts.invitedBy ?? "Someone"} invited you to ${opts.teamName}`,
            message: "Join the workspace to collaborate on vaults, agents, and treasury operations.",
            meta: {
                avatarUrl: opts.avatarUrl,
                initials: opts.invitedBy?.slice(0, 2),
                actions: [
                    {
                        label: "Accept",
                        variant: "primary",
                        onClick: async ({ dismiss }) => {
                            await opts.onAccept();
                            dismiss();
                        },
                    },
                    {
                        label: "Decline",
                        variant: "ghost",
                        onClick: async ({ dismiss }) => {
                            await opts.onDecline();
                            dismiss();
                        },
                    },
                ],
            },
        });
    },

    /** Signature approval request from an agent — Approve / Reject inline. */
    signatureRequest: (opts: {
        strategyName: string;
        summary: string;
        approvalId: string;
        onApprove: (approvalId: string) => void | Promise<void>;
        onReject: (approvalId: string) => void | Promise<void>;
    }) => {
        useNotificationStore.getState().addNotification({
            type: "agent_alert",
            title: `Approval needed · ${opts.strategyName}`,
            message: opts.summary,
            href: "/app",
            meta: {
                approvalId: opts.approvalId,
                actions: [
                    {
                        label: "Approve",
                        variant: "primary",
                        onClick: async ({ dismiss }) => {
                            await opts.onApprove(opts.approvalId);
                            dismiss();
                        },
                    },
                    {
                        label: "Reject",
                        variant: "ghost",
                        onClick: async ({ dismiss }) => {
                            await opts.onReject(opts.approvalId);
                            dismiss();
                        },
                    },
                ],
            },
        });
    },

    /** Security confirmation — e.g. "Was this you?" with Yes / Lock account. */
    securityConfirm: (opts: {
        title: string;
        message: string;
        onConfirm: () => void | Promise<void>;
        onReject: () => void | Promise<void>;
        confirmLabel?: string;
        rejectLabel?: string;
    }) => {
        useNotificationStore.getState().addNotification({
            type: "security",
            title: opts.title,
            message: opts.message,
            meta: {
                actions: [
                    {
                        label: opts.confirmLabel ?? "Yes, it was me",
                        variant: "ghost",
                        onClick: async ({ dismiss }) => {
                            await opts.onConfirm();
                            dismiss();
                        },
                    },
                    {
                        label: opts.rejectLabel ?? "Lock account",
                        variant: "primary",
                        onClick: async ({ dismiss }) => {
                            await opts.onReject();
                            dismiss();
                        },
                    },
                ],
            },
        });
    },
};
