import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendReengagementEmail } from '@/lib/email-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'reengagement',
    lastSentColumn: 'lastReengagementAt',
    minHoursSinceLast: 24 * 14,
  });
  const now = Date.now();
  let sent = 0, failed = 0;
  for (const u of users) {
    const daysAway = Math.floor((now - new Date(u.lastLoginAt).getTime()) / (24 * 3600 * 1000));
    if (daysAway < 14) continue;
    const r = await sendReengagementEmail({
      to: u.email, displayName: u.displayName,
      daysAway,
      vaultActivity: 'Your tracked positions saw transfers and price movement while you were gone.',
    });
    if (r.success) { await stampSent(u.id, 'lastReengagementAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed });
}
