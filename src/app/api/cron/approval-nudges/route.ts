import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendApprovalNudgeEmail } from '@/lib/email-service';
import { getPendingApprovals } from '@/lib/email-aggregations';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'approvalNudges',
    lastSentColumn: 'lastApprovalNudgeAt',
    minHoursSinceLast: 24,
  });
  let sent = 0, failed = 0, skipped = 0;
  for (const u of users) {
    const pending = await getPendingApprovals(u.id);
    if (!pending) { skipped++; continue; }
    const r = await sendApprovalNudgeEmail({
      to: u.email,
      displayName: u.displayName,
      count: pending.count,
      oldestHours: pending.oldestHours,
    });
    if (r.success) { await stampSent(u.id, 'lastApprovalNudgeAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed, skipped });
}
