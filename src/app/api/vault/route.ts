import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { vaults, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";
import { errors } from "@/lib/api-error";
export const runtime = "edge";

// Tier limits for vault creation
const TIER_VAULT_LIMITS: Record<string, number> = {
  free: 1,
  mini: 3,
  max: 10,
};

/**
 * GET /api/vault — List vaults for the authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return errors.unauthorized();
    if (!db) return errors.serviceUnavailable("Database");

    const userVaults = await db
      .select()
      .from(vaults)
      .where(eq(vaults.userId, authUser.id));

    return NextResponse.json({ vaults: userVaults });
  } catch (error) {
    console.error("[vault/GET] Error:", error);
    return errors.internal("Failed to fetch vaults");
  }
}

/**
 * POST /api/vault — Register a vault (after on-chain creation OR as watch-only).
 * Enforces tier-based vault limits.
 *
 * Body: { address, label?, isMultisig?, kind?: 'connected'|'watch'|'multisig' }
 */
export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return errors.unauthorized();
    if (!db) return errors.serviceUnavailable("Database");

    const body = await request.json();
    const { address, label, isMultisig } = body;
    const kindRaw = typeof body.kind === "string" ? body.kind : null;
    const kind: "connected" | "watch" | "multisig" =
      kindRaw === "watch" || kindRaw === "multisig" || kindRaw === "connected"
        ? kindRaw
        : isMultisig
          ? "multisig"
          : "connected";

    if (!address || typeof address !== "string" || address.length < 32 || address.length > 44) {
      return errors.badRequest("Valid Solana address required");
    }

    // Look up user tier
    const [user] = await db
      .select({ tier: users.tier })
      .from(users)
      .where(eq(users.id, authUser.id))
      .limit(1);

    if (!user) return errors.notFound("User");

    const limit = TIER_VAULT_LIMITS[user.tier] ?? 1;

    // Count existing vaults
    const existingVaults = await db
      .select()
      .from(vaults)
      .where(eq(vaults.userId, authUser.id));

    // Tier limit applies to user-added "watch" vaults only.
    // A user's own connected wallet and self-deployed multisigs should never be
    // blocked — otherwise creating a Squads multisig from the CommandBar fails
    // silently for free-tier users whose 1 slot is occupied by their wallet.
    const countedExisting = existingVaults.filter((v) => v.kind === "watch").length;
    const incomingCounts = kind === "watch";

    if (incomingCounts && countedExisting >= limit) {
      return NextResponse.json(
        {
          error: {
            code: "VAULT_LIMIT_REACHED",
            message: `Your ${user.tier} tier allows ${limit} vault${limit !== 1 ? "s" : ""}. Upgrade to add more.`,
          },
          currentCount: existingVaults.length,
          limit,
          tier: user.tier,
        },
        { status: 403 }
      );
    }

    // Check for duplicate address
    const existing = existingVaults.find((v) => v.address === address);
    if (existing) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "Vault already registered" }, vault: existing },
        { status: 409 }
      );
    }

    // Persist the vault
    const [newVault] = await db
      .insert(vaults)
      .values({
        userId: authUser.id,
        address,
        label: label || (kind === "watch" ? "Watched address" : kind === "multisig" ? "Squads multisig" : "My Wallet"),
        isMultisig: isMultisig ?? kind === "multisig",
        kind,
      })
      .returning();

    return NextResponse.json({ vault: newVault }, { status: 201 });
  } catch (error) {
    console.error("[vault/POST] Error:", error);
    return errors.internal("Failed to create vault");
  }
}
