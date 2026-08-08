import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendAgentInsightEmail } from '@/lib/email-service';
import { getFreshAgentInsight } from '@/lib/email-aggregations';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'agentInsights',
    lastSentColumn: 'lastAgentInsightAt',
    minHoursSinceLast: 24, // throttle: 1/day
  });
  let sent = 0, failed = 0, skipped = 0;
  for (const u of users) {
    const insight = await getFreshAgentInsight(u.id, 24);
    if (!insight) { skipped++; continue; }
    const r = await sendAgentInsightEmail({ to: u.email, displayName: u.displayName, ...insight });
    if (r.success) { await stampSent(u.id, 'lastAgentInsightAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed, skipped });
}
