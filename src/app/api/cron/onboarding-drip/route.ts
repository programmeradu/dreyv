import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { db } from '@/db';
import { users, emailPreferences } from '@/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import {
  sendOnboardingDay1Email,
  sendOnboardingDay3Email,
  sendOnboardingDay7Email,
} from '@/lib/email-service';
import { stampSent } from '@/lib/email-eligibility';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  if (!db) return NextResponse.json({ error: 'no db' }, { status: 503 });

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      createdAt: users.createdAt,
      prefs: emailPreferences,
    })
    .from(users)
    .leftJoin(emailPreferences, eq(emailPreferences.userId, users.id))
    .where(isNotNull(users.email));

  const now = Date.now();
  let d1 = 0, d3 = 0, d7 = 0, failed = 0;
  for (const u of rows) {
    if (!u.email) continue;
    const p = u.prefs;
    if (p && (p.emailsEnabled === false || p.onboardingDrip === false)) continue;
    const ageDays = Math.floor((now - new Date(u.createdAt).getTime()) / (24 * 3600 * 1000));

    if (ageDays >= 1 && !(p?.onboardingDay1SentAt)) {
      const r = await sendOnboardingDay1Email(u.email, u.displayName);
      if (r.success) { await stampSent(u.id, 'onboardingDay1SentAt'); d1++; } else failed++;
    } else if (ageDays >= 3 && !(p?.onboardingDay3SentAt)) {
      const r = await sendOnboardingDay3Email(u.email, u.displayName);
      if (r.success) { await stampSent(u.id, 'onboardingDay3SentAt'); d3++; } else failed++;
    } else if (ageDays >= 7 && !(p?.onboardingDay7SentAt)) {
      const r = await sendOnboardingDay7Email(u.email, u.displayName);
      if (r.success) { await stampSent(u.id, 'onboardingDay7SentAt'); d7++; } else failed++;
    }
  }
  return NextResponse.json({ ok: true, day1: d1, day3: d3, day7: d7, failed });
}
