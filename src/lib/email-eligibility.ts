import { db } from '@/db';
import { users, emailPreferences } from '@/db/schema';
import { eq, isNotNull, and, or, lte, isNull, sql } from 'drizzle-orm';

export type EligibleUser = {
  id: string;
  email: string;
  displayName: string | null;
  tier: string;
  createdAt: Date;
  lastLoginAt: Date;
  prefs: typeof emailPreferences.$inferSelect | null;
};

/**
 * Get users eligible for a given proactive email stream.
 * Filters: emailsEnabled = true, stream-specific opt-in = true,
 * throttle: lastSentAt is null OR older than minHoursSinceLast.
 */
export async function getEligibleUsers(opts: {
  streamColumn: keyof typeof emailPreferences.$inferSelect;
  lastSentColumn: keyof typeof emailPreferences.$inferSelect;
  minHoursSinceLast: number;
}): Promise<EligibleUser[]> {
  if (!db) return [];
  const { streamColumn, lastSentColumn, minHoursSinceLast } = opts;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      tier: users.tier,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      prefs: emailPreferences,
    })
    .from(users)
    .leftJoin(emailPreferences, eq(emailPreferences.userId, users.id))
    .where(isNotNull(users.email));

  const cutoff = new Date(Date.now() - minHoursSinceLast * 3600 * 1000);
  return rows
    .filter((r) => !!r.email)
    .filter((r) => {
      const p = r.prefs;
      // No prefs row → use defaults (enabled).
      if (!p) return true;
      if (p.emailsEnabled === false) return false;
      if ((p as any)[streamColumn] === false) return false;
      const last = (p as any)[lastSentColumn] as Date | null;
      if (last && last > cutoff) return false;
      return true;
    }) as EligibleUser[];
}

/**
 * Upsert email_preferences and stamp the lastSentColumn.
 */
export async function stampSent(userId: string, column: keyof typeof emailPreferences.$inferSelect) {
  if (!db) return;
  // Upsert via raw — drizzle onConflict varies; do select+update/insert.
  const [existing] = await db
    .select({ id: emailPreferences.id })
    .from(emailPreferences)
    .where(eq(emailPreferences.userId, userId))
    .limit(1);
  if (existing) {
    await db
      .update(emailPreferences)
      .set({ [column]: new Date(), updatedAt: new Date() } as any)
      .where(eq(emailPreferences.userId, userId));
  } else {
    await db.insert(emailPreferences).values({
      userId,
      [column]: new Date(),
    } as any);
  }
}
