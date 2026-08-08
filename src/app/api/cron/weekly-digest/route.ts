import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendWeeklyDigestEmail } from '@/lib/email-service';
import { getWeeklyDigest } from '@/lib/email-aggregations';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'weeklyDigest',
    lastSentColumn: 'lastWeeklyDigestAt',
    minHoursSinceLast: 24 * 6,
  });
  const weekLabel = `Week of ${new Date().toISOString().slice(0, 10)}`;
  let sent = 0, failed = 0, skipped = 0;
  for (const u of users) {
    const data = await getWeeklyDigest(u.id);
    if (!data) { skipped++; continue; }
    const r = await sendWeeklyDigestEmail({
      to: u.email,
      displayName: u.displayName,
      weekLabel,
      ...data,
    });
    if (r.success) { await stampSent(u.id, 'lastWeeklyDigestAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed, skipped });
}
