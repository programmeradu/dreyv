import { NextRequest, NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { getEligibleUsers, stampSent } from '@/lib/email-eligibility';
import { sendReengagementEmail } from '@/lib/email-service';
import { getUserWallets } from '@/lib/email-aggregations';
import { db } from '@/db';
import { treasuryEvents } from '@/db/schema';
import { and, gte, inArray, sql } from 'drizzle-orm';
export const runtime = "edge";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const fail = verifyCron(req); if (fail) return fail;
  const users = await getEligibleUsers({
    streamColumn: 'reengagement',
    lastSentColumn: 'lastReengagementAt',
    minHoursSinceLast: 24 * 14,
  });
  const now = Date.now();
  let sent = 0, failed = 0, skipped = 0;
  for (const u of users) {
    const daysAway = Math.floor((now - new Date(u.lastLoginAt).getTime()) / (24 * 3600 * 1000));
    if (daysAway < 14) { skipped++; continue; }

    const wallets = await getUserWallets(u.id);
    if (!wallets.length || !db) { skipped++; continue; }

    const since = new Date(now - daysAway * 24 * 3600 * 1000);
    const [agg] = await db
      .select({
        events: sql<string>`COUNT(*)`,
        net: sql<string>`COALESCE(SUM(${treasuryEvents.amountUsd}), 0)`,
      })
      .from(treasuryEvents)
      .where(and(inArray(treasuryEvents.walletAddress, wallets), gte(treasuryEvents.occurredAt, since)));
    const events = Number(agg?.events ?? 0);
    const net = Number(agg?.net ?? 0);
    if (events === 0) { skipped++; continue; }

    const vaultActivity = `${events} treasury event${events === 1 ? '' : 's'} fired while you were away · net ${net >= 0 ? '+' : ''}${net.toFixed(0)} USD.`;
    const r = await sendReengagementEmail({
      to: u.email, displayName: u.displayName, daysAway, vaultActivity,
    });
    if (r.success) { await stampSent(u.id, 'lastReengagementAt'); sent++; } else { failed++; }
  }
  return NextResponse.json({ ok: true, eligible: users.length, sent, failed, skipped });
}
