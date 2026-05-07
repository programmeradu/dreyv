import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendApprovalNudgeEmail } from '@/lib/email-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); 
  if (fail) return fail;

  const users = await getEligibleUsers({
    streamColumn: 'approvalNudges',
    lastSentColumn: 'lastApprovalNudgeAt',
    minHoursSinceLast: 24,
  });

  let sent = 0;
  let failed = 0;

  for (const u of users) {
    // TODO: wire to real pending multi-sig proposals per user (>24h old).
    // For now: no-op iterator — keeps cron live without spamming.
    const pending = 0; 
    const oldestHours = 0;
    
    if (pending === 0) continue;
    
    const r = await sendApprovalNudgeEmail({ 
      to: u.email, 
      displayName: u.displayName, 
      count: pending, 
      oldestHours 
    });
    
    if (r.success) { 
      await stampSent(u.id, 'lastApprovalNudgeAt'); 
      sent++; 
    } else { 
      failed++; 
    }
  }
  
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed });
}
