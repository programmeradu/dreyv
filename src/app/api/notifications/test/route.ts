export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { notificationPreferences } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth-utils';
import { fanOutNotification } from '@/lib/notification-delivery';

/**
 * POST /api/notifications/test
 * Body: { channel: 'telegram' | 'slack' }
 * Sends a synthetic notification to the requested channel only, using the
 * caller's saved preferences. Returns the per-channel delivery result so
 * the UI can show "✓ delivered" or the upstream error verbatim.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const { channel } = await request.json().catch(() => ({}));
  if (channel !== 'telegram' && channel !== 'slack') {
    return NextResponse.json({ error: 'channel must be telegram or slack' }, { status: 400 });
  }

  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.id))
    .limit(1);

  if (!prefs) {
    return NextResponse.json({ error: 'Save your preferences first.' }, { status: 400 });
  }
  if (channel === 'telegram' && (!prefs.telegramBotToken || !prefs.telegramChatId)) {
    return NextResponse.json(
      { error: 'Telegram bot token and chat ID are both required.' },
      { status: 400 },
    );
  }
  if (channel === 'slack' && !prefs.slackWebhookUrl) {
    return NextResponse.json({ error: 'Slack webhook URL not configured.' }, { status: 400 });
  }

  // Force only the requested channel by zeroing out the other.
  const results = await fanOutNotification(
    {
      notificationId: 0, // synthetic — won't FK-reference, logging will fail-soft
      title: 'Dreyv test notification',
      message: `If you can read this, ${channel} delivery is working.`,
      severity: 'info',
      actionUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://dreyv.com',
      actionLabel: 'Open Dreyv',
    },
    {
      emailEnabled: false,
      telegramEnabled: channel === 'telegram',
      telegramBotToken: prefs.telegramBotToken,
      telegramChatId: prefs.telegramChatId,
      slackEnabled: channel === 'slack',
      slackWebhookUrl: prefs.slackWebhookUrl,
      slackChannel: prefs.slackChannel,
    },
  );

  const r = results[0];
  if (!r) return NextResponse.json({ error: 'No delivery attempted' }, { status: 500 });
  return NextResponse.json({ success: r.status === 'sent', result: r });
}
