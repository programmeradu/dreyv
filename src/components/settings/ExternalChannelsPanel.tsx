"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast-notifications";
import { TelegramLogo, SlackLogo } from "@/components/brand/ChannelLogos";

/**
 * Phase 15 — External channel preferences (Telegram + Slack).
 * Standalone panel that talks directly to /api/notifications/preferences
 * and /api/notifications/test, independent of the legacy local store.
 */

interface ExternalPrefs {
    telegramEnabled: boolean;
    telegramBotToken: string | null;
    telegramChatId: string | null;
    slackEnabled: boolean;
    slackWebhookUrl: string | null;
    slackChannel: string | null;
}

const EMPTY: ExternalPrefs = {
    telegramEnabled: false,
    telegramBotToken: "",
    telegramChatId: "",
    slackEnabled: false,
    slackWebhookUrl: "",
    slackChannel: "",
};

export const ExternalChannelsPanel: React.FC = () => {
    const [prefs, setPrefs] = useState<ExternalPrefs>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState<"telegram" | "slack" | null>(null);

    useEffect(() => {
        fetch("/api/notifications/preferences")
            .then((r) => r.json())
            .then((d) => {
                const p = d?.preferences ?? {};
                setPrefs({
                    telegramEnabled: !!p.telegramEnabled,
                    telegramBotToken: p.telegramBotToken ?? "",
                    telegramChatId: p.telegramChatId ?? "",
                    slackEnabled: !!p.slackEnabled,
                    slackWebhookUrl: p.slackWebhookUrl ?? "",
                    slackChannel: p.slackChannel ?? "",
                });
            })
            .catch(() => toast.error("Could not load notification preferences"))
            .finally(() => setLoading(false));
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/notifications/preferences", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(prefs),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Save failed");
            toast.success("Channel preferences saved");
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const test = async (channel: "telegram" | "slack") => {
        setTesting(channel);
        try {
            const res = await fetch("/api/notifications/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || data.result?.error || "Delivery failed");
            }
            toast.success(`${channel} test delivered ✓`);
        } catch (err) {
            toast.error(`${channel} test failed: ${(err as Error).message}`);
        } finally {
            setTesting(null);
        }
    };

    if (loading) {
        return (
            <div className="bg-card border border-border rounded-2xl p-6 flex items-center gap-3 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Loading external channels…
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-muted-foreground uppercase tracking-widest">
                    External Channels
                </h3>
                <Button
                    size="sm"
                    onClick={save}
                    disabled={saving}
                    className="h-7 text-[10px] font-black uppercase tracking-wider"
                >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                </Button>
            </div>

            {/* Telegram */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="p-1.5 rounded-lg bg-white border border-[#229ED9]/20 flex items-center justify-center">
                            <TelegramLogo size={26} />
                        </div>
                        <div>
                            <h4 className="text-sm font-black text-foreground uppercase tracking-tight">Telegram</h4>
                            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">
                                Bring your own bot — Dreyv hosts none
                            </p>
                        </div>
                    </div>
                    <Toggle
                        on={prefs.telegramEnabled}
                        onChange={(v) => setPrefs({ ...prefs, telegramEnabled: v })}
                    />
                </div>

                <Field
                    label="Bot token"
                    placeholder="123456789:AA...your-bot-token"
                    value={prefs.telegramBotToken ?? ""}
                    onChange={(v) => setPrefs({ ...prefs, telegramBotToken: v })}
                    hint="Open @BotFather on Telegram → /newbot → copy the HTTP API token it gives you."
                    secret
                />
                <Field
                    label="Chat ID"
                    placeholder="e.g. 123456789"
                    value={prefs.telegramChatId ?? ""}
                    onChange={(v) => setPrefs({ ...prefs, telegramChatId: v })}
                    hint="Message your bot once, then visit api.telegram.org/bot<token>/getUpdates to find your numeric chat ID."
                />

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <span className="text-[10px] text-muted-foreground">
                        {prefs.telegramBotToken && prefs.telegramChatId
                            ? <>Configured · ID <code>{prefs.telegramChatId}</code></>
                            : "Not configured"}
                    </span>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => test("telegram")}
                        disabled={!prefs.telegramBotToken || !prefs.telegramChatId || testing === "telegram"}
                        className="h-7 text-[10px] font-black uppercase tracking-wider gap-1.5"
                    >
                        {testing === "telegram" ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                        Test
                    </Button>
                </div>
            </div>

            {/* Slack */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="p-1.5 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                            <SlackLogo size={26} />
                        </div>
                        <div>
                            <h4 className="text-sm font-black text-foreground uppercase tracking-tight">Slack</h4>
                            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">
                                Posts to a channel via incoming webhook
                            </p>
                        </div>
                    </div>
                    <Toggle
                        on={prefs.slackEnabled}
                        onChange={(v) => setPrefs({ ...prefs, slackEnabled: v })}
                    />
                </div>

                <Field
                    label="Incoming webhook URL"
                    placeholder="https://hooks.slack.com/services/T.../B.../..."
                    value={prefs.slackWebhookUrl ?? ""}
                    onChange={(v) => setPrefs({ ...prefs, slackWebhookUrl: v })}
                    hint="Create one at api.slack.com → Your Apps → Incoming Webhooks."
                />
                <Field
                    label="Channel override (optional)"
                    placeholder="#treasury-alerts"
                    value={prefs.slackChannel ?? ""}
                    onChange={(v) => setPrefs({ ...prefs, slackChannel: v })}
                    hint="Leave blank to post to the webhook's default channel."
                />

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <span className="text-[10px] text-muted-foreground">
                        {prefs.slackWebhookUrl ? "Webhook configured" : "Not configured"}
                    </span>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => test("slack")}
                        disabled={!prefs.slackWebhookUrl || testing === "slack"}
                        className="h-7 text-[10px] font-black uppercase tracking-wider gap-1.5"
                    >
                        {testing === "slack" ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                        Test
                    </Button>
                </div>
            </div>

            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                Channel deliveries are logged and shown per notification — failed sends never block in-app or email delivery.
            </p>
        </div>
    );
};

// ─── tiny inline primitives ──────────────────────────────────────────
const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void }> = ({ on, onChange }) => (
    <button
        onClick={() => onChange(!on)}
        className={`w-10 h-5 rounded-full p-1 transition-colors shadow-inner shrink-0 ${on ? "bg-primary" : "bg-muted"}`}
        aria-pressed={on}
    >
        <div className={`w-3 h-3 rounded-full bg-background shadow-sm transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
);

const Field: React.FC<{
    label: string;
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
    hint?: string;
    secret?: boolean;
}> = ({ label, placeholder, value, onChange, hint, secret }) => (
    <div className="space-y-1.5">
        <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">{label}</label>
        <input
            type={secret ? "password" : "text"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
        />
        {hint && <p className="text-[10px] text-muted-foreground/70 flex items-start gap-1"><XCircle size={10} className="opacity-0" />{hint}</p>}
    </div>
);
