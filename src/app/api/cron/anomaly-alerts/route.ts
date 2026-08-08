import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendAnomalyAlertEmail } from '@/lib/email-service';
import { getFreshAnomaly } from '@/lib/email-aggregations';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'anomalyAlerts',
    lastSentColumn: 'lastAnomalyAt',
    minHoursSinceLast: 1, // immediate, but max 1/hr
  });
  let sent = 0, failed = 0, skipped = 0;
  for (const u of users) {
    const anomaly = await getFreshAnomaly(u.id, 2);
    if (!anomaly) { skipped++; continue; }
    const r = await sendAnomalyAlertEmail({ to: u.email, ...anomaly });
    if (r.success) { await stampSent(u.id, 'lastAnomalyAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed, skipped });
}
