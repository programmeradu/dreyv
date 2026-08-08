export const runtime = "edge";
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { notificationPreferences } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth-utils';

/**
 * GET /api/notifications/preferences
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  try {
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, user.id))
      .limit(1);

    // Return defaults if no preferences saved yet
    return NextResponse.json({
      preferences: prefs || {
        emailEnabled: true,
        teamInvites: true,
        roleChanges: true,
        txApprovals: true,
        systemAlerts: true,
        tierExpiry: true,
        telegramEnabled: false,
        telegramBotToken: null,
        telegramChatId: null,
        slackEnabled: false,
        slackWebhookUrl: null,
        slackChannel: null,
      },
    });
  } catch (err) {
    console.error('[Prefs API] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
  }
}

/**
 * PUT /api/notifications/preferences
 */
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const boolKeys = [
      'emailEnabled', 'teamInvites', 'roleChanges', 'txApprovals',
      'systemAlerts', 'tierExpiry', 'telegramEnabled', 'slackEnabled',
    ];
    for (const key of boolKeys) {
      if (body[key] !== undefined) updates[key] = Boolean(body[key]);
    }

    // String fields — normalize empties to null so we don't store "".
    const stringKeys = ['telegramBotToken', 'telegramChatId', 'slackWebhookUrl', 'slackChannel'];
    for (const key of stringKeys) {
      if (body[key] !== undefined) {
        const v = typeof body[key] === 'string' ? body[key].trim() : body[key];
        updates[key] = v ? v : null;
      }
    }

    // Light validation: Slack webhook must look like a Slack URL if provided.
    if (typeof updates.slackWebhookUrl === 'string') {
      const url = updates.slackWebhookUrl as string;
      if (!/^https:\/\/hooks\.slack\.com\//.test(url)) {
        return NextResponse.json(
          { error: 'Slack webhook must start with https://hooks.slack.com/' },
          { status: 400 },
        );
      }
    }

    // Upsert
    const [existing] = await db
      .select({ id: notificationPreferences.id })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, user.id))
      .limit(1);

    if (existing) {
      await db
        .update(notificationPreferences)
        .set(updates)
        .where(eq(notificationPreferences.userId, user.id));
    } else {
      await db.insert(notificationPreferences).values({
        userId: user.id,
        ...updates,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Prefs API] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }
}
