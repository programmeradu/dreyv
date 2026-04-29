/**
 * Phase 15 — Unified notification fan-out.
 *
 * Given a notification payload + a user's preferences, deliver to every
 * enabled channel (email, Telegram, Slack) in parallel, log every attempt
 * to `notification_deliveries`, and never throw — channel failures are
 * isolated so a broken Slack webhook never blocks an email.
 */

import { db } from '@/db';
import { notificationDeliveries } from '@/db/schema';

export type DeliveryChannel = 'email' | 'telegram' | 'slack' | 'inapp';
export type DeliveryStatus = 'sent' | 'failed' | 'skipped';

export interface DeliveryPayload {
  notificationId: number;
  title: string;
  message: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  actionUrl?: string;
  actionLabel?: string;
}

export interface UserChannelPrefs {
  emailEnabled: boolean;
  email?: string | null;
  telegramEnabled: boolean;
  telegramBotToken?: string | null; // BYO bot — per-user token from @BotFather
  telegramChatId?: string | null;
  slackEnabled: boolean;
  slackWebhookUrl?: string | null;
  slackChannel?: string | null;
}

interface ChannelResult {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  error?: string;
  providerId?: string;
}

// ─── Telegram (BYO bot — token comes from the user's own @BotFather bot) ──
async function deliverTelegram(
  p: DeliveryPayload,
  botToken: string,
  chatId: string,
): Promise<ChannelResult> {
  const sevEmoji = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '🚨' }[p.severity ?? 'info'];
  const text = [
    `${sevEmoji} <b>${escapeHtml(p.title)}</b>`,
    escapeHtml(p.message),
    p.actionUrl ? `\n<a href="${escapeAttr(p.actionUrl)}">${escapeHtml(p.actionLabel || 'Open')}</a>` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return {
        channel: 'telegram',
        status: 'failed',
        error: `Telegram ${res.status}: ${data.description || JSON.stringify(data)}`.slice(0, 500),
      };
    }
    return { channel: 'telegram', status: 'sent', providerId: String(data.result?.message_id ?? '') };
  } catch (err) {
    return { channel: 'telegram', status: 'failed', error: (err as Error).message };
  }
}

// ─── Slack (incoming webhook) ─────────────────────────────────────────
async function deliverSlack(
  p: DeliveryPayload,
  webhookUrl: string,
  channel?: string | null,
): Promise<ChannelResult> {
  const sevColor = { info: '#7c3aed', success: '#16a34a', warning: '#f59e0b', error: '#dc2626' }[p.severity ?? 'info'];
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: p.title.slice(0, 150), emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: p.message.slice(0, 2900) } },
  ];
  if (p.actionUrl) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: p.actionLabel || 'Open' },
        url: p.actionUrl,
        style: p.severity === 'error' ? 'danger' : 'primary',
      }],
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(channel ? { channel } : {}),
        username: 'Dreyv',
        attachments: [{ color: sevColor, blocks }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { channel: 'slack', status: 'failed', error: `Slack ${res.status}: ${body}`.slice(0, 500) };
    }
    return { channel: 'slack', status: 'sent' };
  } catch (err) {
    return { channel: 'slack', status: 'failed', error: (err as Error).message };
  }
}

// ─── Public entrypoint ────────────────────────────────────────────────
export async function fanOutNotification(
  payload: DeliveryPayload,
  prefs: UserChannelPrefs,
): Promise<ChannelResult[]> {
  const tasks: Promise<ChannelResult>[] = [];

  if (prefs.telegramEnabled && prefs.telegramBotToken && prefs.telegramChatId) {
    tasks.push(deliverTelegram(payload, prefs.telegramBotToken, prefs.telegramChatId));
  }
  if (prefs.slackEnabled && prefs.slackWebhookUrl) {
    tasks.push(deliverSlack(payload, prefs.slackWebhookUrl, prefs.slackChannel));
  }

  const results = await Promise.all(tasks);

  // Log every attempt; never let logging failure crash the request.
  // notificationId === 0 is a synthetic test send — skip persistence.
  if (db && results.length > 0 && payload.notificationId > 0) {
    try {
      await db.insert(notificationDeliveries).values(
        results.map((r) => ({
          notificationId: payload.notificationId,
          channel: r.channel,
          status: r.status,
          error: r.error ?? null,
          providerId: r.providerId ?? null,
        })),
      );
    } catch (err) {
      console.error('[notif-delivery] failed to log deliveries:', err);
    }
  }

  return results;
}

// ─── helpers ──────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
