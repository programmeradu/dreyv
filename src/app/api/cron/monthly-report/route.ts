export const runtime = "edge";
import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendMonthlyReportEmail } from '@/lib/email-service';
import { getMonthlyReport } from '@/lib/email-aggregations';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'monthlyReport',
    lastSentColumn: 'lastMonthlyReportAt',
    minHoursSinceLast: 24 * 25,
  });
  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  let sent = 0, failed = 0, skipped = 0;
  for (const u of users) {
    const data = await getMonthlyReport(u.id);
    if (!data) { skipped++; continue; }
    const r = await sendMonthlyReportEmail({
      to: u.email,
      displayName: u.displayName,
      monthLabel,
      ...data,
    });
    if (r.success) { await stampSent(u.id, 'lastMonthlyReportAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed, skipped });
}
