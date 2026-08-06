import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendOpportunityEmail } from '@/lib/email-service';
import { getFreshOpportunity } from '@/lib/email-aggregations';
export const runtime = "edge";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'opportunities',
    lastSentColumn: 'lastOpportunityAt',
    minHoursSinceLast: 24,
  });
  let sent = 0, failed = 0, skipped = 0;
  for (const u of users) {
    const opp = await getFreshOpportunity(u.id, 24);
    if (!opp) { skipped++; continue; }
    const r = await sendOpportunityEmail({ to: u.email, displayName: u.displayName, ...opp });
    if (r.success) { await stampSent(u.id, 'lastOpportunityAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed, skipped });
}
