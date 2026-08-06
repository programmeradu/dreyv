import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendVaultCommandsEmail } from '@/lib/email-service';
import { getVaultCommands } from '@/lib/email-aggregations';
export const runtime = "edge";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'vaultCommands',
    lastSentColumn: 'lastVaultCommandsAt',
    minHoursSinceLast: 24 * 6,
  });
  let sent = 0, failed = 0, skipped = 0;
  for (const u of users) {
    const commands = await getVaultCommands(u.id);
    if (!commands || commands.length === 0) { skipped++; continue; }
    const r = await sendVaultCommandsEmail({ to: u.email, displayName: u.displayName, commands });
    if (r.success) { await stampSent(u.id, 'lastVaultCommandsAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed, skipped });
}
