export const runtime = "edge";
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { notifications, notificationPreferences, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth-utils';
import { sendNotificationEmail } from '@/lib/email-service';
import { fanOutNotification } from '@/lib/notification-delivery';

/**
 * POST /api/notifications/send
 * Internal: Creates a notification record AND fans it out to every
 * external channel the user has enabled (email, Telegram, Slack).
 *
 * Body: { userId, type, title, message, severity?, actionUrl?, actionLabel?,
 *         relatedEntityType?, relatedEntityId? }
 */
export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  try {
    const body = await request.json();
    const targetUserId = body.userId || authUser.id;

    // 1) Persist the in-app notification first.
    const [notif] = await db.insert(notifications).values({
      userId: targetUserId,
      type: body.type || 'system',
      title: body.title,
      message: body.message,
      severity: body.severity || 'info',
      actionUrl: body.actionUrl,
      actionLabel: body.actionLabel,
      relatedEntityType: body.relatedEntityType,
      relatedEntityId: body.relatedEntityId,
      metadata: body.metadata,
    }).returning({ id: notifications.id });

    // 1b) Fan out to subscribed Phase-5 webhooks (fire-and-forget; the
    // dispatcher records its own delivery log and never throws upstream).
    void import("@/lib/webhooks/dispatcher").then(({ emitWebhookEvent }) =>
      emitWebhookEvent({
        userId: targetUserId,
        event: "notification.created",
        data: {
          id: notif?.id,
          type: body.type || "system",
          title: body.title,
          message: body.message,
          severity: body.severity || "info",
          actionUrl: body.actionUrl,
          actionLabel: body.actionLabel,
          relatedEntityType: body.relatedEntityType,
          relatedEntityId: body.relatedEntityId,
          metadata: body.metadata,
        },
      }).catch((err) => console.error("[notifications.send] webhook fanout failed:", err)),
    );



    // 2) Load the user's channel preferences + email in one shot.
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, targetUserId))
      .limit(1);

    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dreyv.com';
    const fullActionUrl = body.actionUrl
      ? (body.actionUrl.startsWith('http') ? body.actionUrl : `${baseUrl}${body.actionUrl}`)
      : undefined;

    // 3) Email (kept inline so the Resend templates render correctly).
    const emailEnabled = prefs?.emailEnabled ?? true;
    if (emailEnabled && user?.email) {
      sendNotificationEmail({
        to: user.email,
        title: body.title,
        message: body.message,
        actionUrl: fullActionUrl,
        actionLabel: body.actionLabel,
      }).catch((err) => console.error('[Notifications] Email failed:', err));
    }

    // 4) Fan out to external channels (Telegram + Slack).
    if (prefs) {
      fanOutNotification(
        {
          notificationId: notif.id,
          title: body.title,
          message: body.message,
          severity: body.severity || 'info',
          actionUrl: fullActionUrl,
          actionLabel: body.actionLabel,
        },
        {
          emailEnabled,
          email: user?.email ?? null,
          telegramEnabled: prefs.telegramEnabled ?? false,
          telegramBotToken: prefs.telegramBotToken,
          telegramChatId: prefs.telegramChatId,
          slackEnabled: prefs.slackEnabled ?? false,
          slackWebhookUrl: prefs.slackWebhookUrl,
          slackChannel: prefs.slackChannel,
        },
      ).catch((err) => console.error('[Notifications] Fan-out failed:', err));
    }

    return NextResponse.json({ success: true, id: notif.id });
  } catch (err) {
    console.error('[Notifications] Send error:', err);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
