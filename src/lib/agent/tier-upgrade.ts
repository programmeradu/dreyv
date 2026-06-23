/**
 * Single source of truth for flipping users.tier after a successful
 * subscription event — used by Stripe webhooks, Paystack webhooks, and
 * x402 settlement on /api/acp/checkout.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export type Tier = "free" | "mini" | "max";

export async function upgradeUserTier(
  userId: string,
  tier: Tier,
  expiresAt: Date | null = null,
): Promise<void> {
  if (!db) throw new Error("Database unavailable");
  await db.update(users).set({ tier, tierExpiresAt: expiresAt }).where(eq(users.id, userId));
}
