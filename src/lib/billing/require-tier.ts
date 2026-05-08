/**
 * requireTier — shared API gate for tier-locked features.
 *
 * Usage:
 *   const gate = await requireTier(req, "mini");
 *   if (!gate.ok) return gate.response;
 *   const { user, tier } = gate;
 *
 * Returns 401 if the caller has no SIWS session, 402 with an upgrade payload
 * if the (founding-aware) tier is below `required`. Mirrors the inline pattern
 * used by /api/team/[id]/invite but lives in /lib so any feature can adopt it
 * without recomputing founding-bumps-free-to-mini.
 *
 * The 402 payload is intentionally rich so the client can surface a fully-
 * formed upgrade card without a second roundtrip:
 *   { error, requiredTier, currentTier, upgradeUrl, founding }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, type AuthUser } from "@/lib/auth-utils";
import { getUserTier, tierAllows, type Tier } from "@/lib/agents/policy/tier-gate";

export type RequireTierOk = {
  ok: true;
  user: AuthUser;
  tier: Tier;
};

export type RequireTierFail = {
  ok: false;
  response: NextResponse;
  status: 401 | 402;
};

export type RequireTierResult = RequireTierOk | RequireTierFail;

const UPGRADE_URLS: Record<Tier, string> = {
  free: "/pricing",
  mini: "/pricing#mini",
  max: "/pricing#max",
};

/**
 * Gate an API route on a minimum tier. Pass the request, the required tier,
 * and (optionally) a feature label to use in the upgrade payload.
 *
 * Founding-200 members get effective Mini access via getUserTier so the gate
 * matches what the agent capability layer enforces elsewhere.
 */
export async function requireTier(
  req: NextRequest | Request,
  required: Tier,
  options: { feature?: string } = {},
): Promise<RequireTierResult> {
  const user = await getAuthUser(req as NextRequest);
  if (!user) {
    return {
      ok: false,
      status: 401,
      response: NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      ),
    };
  }

  const tier = await getUserTier(user.walletAddress);
  if (!tierAllows(tier, required)) {
    const founding = tier !== "free" && (user.tier as Tier) === "free";
    return {
      ok: false,
      status: 402,
      response: NextResponse.json(
        {
          ok: false,
          error: "upgrade_required",
          feature: options.feature ?? null,
          requiredTier: required,
          currentTier: tier,
          founding,
          upgradeUrl: UPGRADE_URLS[required],
        },
        { status: 402 },
      ),
    };
  }

  return { ok: true, user, tier };
}
