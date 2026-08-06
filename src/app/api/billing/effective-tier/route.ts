/**
 * GET /api/billing/effective-tier
 *
 * Returns founding-aware effective tier (same semantics as getUserTier / requireTier)
 * for client-side upgrade CTAs without triggering a mutating API call.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { getUserTier } from "@/lib/agents/policy/tier-gate";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
export const runtime = "edge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let founding = false;
  if (db) {
    const [row] = await db
      .select({ founding: users.isFoundingMember })
      .from(users)
      .where(eq(users.walletAddress, user.walletAddress))
      .limit(1);
    founding = Boolean(row?.founding);
  }
  const effectiveTier = await getUserTier(user.walletAddress);
  return NextResponse.json({
    ok: true,
    effectiveTier,
    founding,
    walletAddress: user.walletAddress,
  });
}
