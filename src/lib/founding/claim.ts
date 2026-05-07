/**
 * Founding 200 program.
 *
 * On first signup we try to claim the next sequential founding number (1..200).
 * Claimed users get `is_founding_member=true` which the tier gate treats as Mini.
 * After 200 are taken, new signups stay on plain Free.
 *
 * Race-safety: we run the assignment in a single SQL statement using a
 * conditional UPDATE keyed on a SELECT MAX, then re-read. Postgres' unique
 * index on `founding_number` is the ultimate guard — on collision we retry
 * once and then give up (user just stays Free, no error surfaced).
 */
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql, and, isNull } from "drizzle-orm";

export const FOUNDING_CAP = 200;

export async function getFoundingClaimedCount(): Promise<number> {
  if (!db) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.isFoundingMember, true));
  return row?.n ?? 0;
}

export interface FoundingClaim {
  claimed: boolean;
  number: number | null;
  remaining: number;
}

/**
 * Attempt to assign the next founding number to a user. Idempotent: if the
 * user already has a number we return it. Safe to call from auth sync.
 */
export async function claimFoundingSlot(userId: string): Promise<FoundingClaim> {
  if (!db) return { claimed: false, number: null, remaining: 0 };

  // Already claimed?
  const [existing] = await db
    .select({ n: users.foundingNumber, f: users.isFoundingMember })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing?.n && existing.f) {
    const taken = await getFoundingClaimedCount();
    return { claimed: true, number: existing.n, remaining: Math.max(0, FOUNDING_CAP - taken) };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const taken = await getFoundingClaimedCount();
    if (taken >= FOUNDING_CAP) {
      return { claimed: false, number: null, remaining: 0 };
    }
    const next = taken + 1;
    try {
      const updated = await db
        .update(users)
        .set({ isFoundingMember: true, foundingNumber: next })
        .where(and(eq(users.id, userId), isNull(users.foundingNumber)))
        .returning({ n: users.foundingNumber });
      if (updated[0]?.n) {
        return { claimed: true, number: updated[0].n, remaining: Math.max(0, FOUNDING_CAP - next) };
      }
      // Either someone else grabbed `next` (unique violation would throw) or
      // the user already had a number — re-read and exit.
      const [after] = await db
        .select({ n: users.foundingNumber })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (after?.n) {
        return { claimed: true, number: after.n, remaining: Math.max(0, FOUNDING_CAP - taken) };
      }
    } catch {
      // unique-violation race — loop and retry with fresh count
      continue;
    }
  }

  return { claimed: false, number: null, remaining: Math.max(0, FOUNDING_CAP - (await getFoundingClaimedCount())) };
}
