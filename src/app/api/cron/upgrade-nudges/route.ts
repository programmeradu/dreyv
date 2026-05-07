import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendUpgradeNudgeEmail } from '@/lib/email-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'upgradeNudges',
    lastSentColumn: 'lastUpgradeNudgeAt',
    minHoursSinceLast: 24 * 7,
  });
  let sent = 0, failed = 0;
  for (const u of users) {
    // TODO: behavioral signal — for now skip non-free/mini.
    let suggested: string | null = null;
    let reason = '';
    if (u.tier === 'free') {
      suggested = 'Mini';
      reason = 'You\'ve been pushing past free-tier limits — Mini unlocks more agent slots and team seats.';
    } else if (u.tier === 'mini') {
      suggested = 'Max';
      reason = 'Your usage now matches a Max-tier treasury — more agents, priority Foresight, deeper Atlas.';
    }
    if (!suggested) continue;
    const r = await sendUpgradeNudgeEmail({
      to: u.email, displayName: u.displayName,
      currentTier: u.tier.charAt(0).toUpperCase() + u.tier.slice(1),
      suggestedTier: suggested, reason,
    });
    if (r.success) { await stampSent(u.id, 'lastUpgradeNudgeAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed });
}
