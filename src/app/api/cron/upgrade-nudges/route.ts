import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendUpgradeNudgeEmail } from '@/lib/email-service';
import { getUpgradeSignal } from '@/lib/email-aggregations';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'upgradeNudges',
    lastSentColumn: 'lastUpgradeNudgeAt',
    minHoursSinceLast: 24 * 7,
  });
  let sent = 0, failed = 0, skipped = 0;
  for (const u of users) {
    const sig = await getUpgradeSignal(u.id, u.tier);
    if (!sig) { skipped++; continue; }
    const r = await sendUpgradeNudgeEmail({
      to: u.email, displayName: u.displayName,
      currentTier: u.tier.charAt(0).toUpperCase() + u.tier.slice(1),
      suggestedTier: sig.suggestedTier, reason: sig.reason,
    });
    if (r.success) { await stampSent(u.id, 'lastUpgradeNudgeAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed, skipped });
}
