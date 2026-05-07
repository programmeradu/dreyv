import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendVaultCommandsEmail } from '@/lib/email-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'vaultCommands',
    lastSentColumn: 'lastVaultCommandsAt',
    minHoursSinceLast: 24 * 6,
  });
  let sent = 0, failed = 0;
  for (const u of users) {
    // TODO: generate from live positions (Foresight + Atlas).
    const commands = [
      { title: 'Sweep idle USDC into a yield route', why: 'Idle stables drag your blended yield. Dryv pre-routes via Marinade or Kamino.' },
      { title: 'Rebalance drift on top position', why: 'Your top holding has drifted past target weight — one approval to trim.' },
      { title: 'Close stale Squads proposal', why: 'A multi-sig proposal is past its expected window — review and clean up.' },
    ];
    const r = await sendVaultCommandsEmail({ to: u.email, displayName: u.displayName, commands });
    if (r.success) { await stampSent(u.id, 'lastVaultCommandsAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed });
}
