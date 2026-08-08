import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { vaults, teams, teamMembers, teamInvitations, teamActivityLog } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "node:crypto";

/**
 * POST /api/vault/:address/invite
 * Create a shareable, single-use invite link for a Squads vault co-signer.
 *
 * Body: { role?: "signer" | "admin" | "viewer", expiresInHours?: number }
 * Returns: { url, token, expiresAt }
 *
 * On the receiving end, the invitee opens /accept-vault-invite?token=...,
 * connects their wallet, and the accept endpoint binds them to the vault's team.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { address } = await ctx.params;
  const trimmed = String(address || "").trim();
  if (trimmed.length < 32 || trimmed.length > 44) {
    return NextResponse.json({ error: "Invalid vault address" }, { status: 400 });
  }

  // Caller must own (or have registered) this vault
  const [vaultRow] = await db
    .select()
    .from(vaults)
    .where(and(eq(vaults.address, trimmed), eq(vaults.userId, user.id)))
    .limit(1);
  if (!vaultRow) {
    return NextResponse.json({ error: "Vault not registered for this account" }, { status: 404 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty body */ }
  const role = (["signer", "admin", "viewer"].includes(body.role) ? body.role : "signer") as
    "signer" | "admin" | "viewer";
  const expiresInHours = Math.min(Math.max(Number(body.expiresInHours) || 72, 1), 24 * 14);

  // Reuse / create the team that owns this vault
  let teamId = vaultRow.teamId as string | null;
  if (!teamId) {
    const [team] = await db
      .insert(teams)
      .values({
        name: `Vault ${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`,
        vaultAddress: trimmed,
        createdBy: user.id,
      })
      .returning();
    teamId = team.id;

    // Add the creator as the owner
    await db.insert(teamMembers).values({
      teamId,
      userId: user.id,
      walletAddress: user.walletAddress,
      role: "owner",
      invitedBy: user.id,
      acceptedAt: new Date(),
      status: "active",
    }).onConflictDoNothing();

    await db.update(vaults).set({ teamId }).where(eq(vaults.id, vaultRow.id));
  }

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await db.insert(teamInvitations).values({
    teamId,
    invitedBy: user.id,
    role,
    token,
    expiresAt,
  });

  await db.insert(teamActivityLog).values({
    teamId,
    userId: user.id,
    action: "invite_created",
    description: `Co-signer invite created for vault ${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`,
  });

  // Build absolute URL the inviter can share
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const base = process.env.NEXT_PUBLIC_APP_URL || (host ? `${proto}://${host}` : "");
  const url = `${base.replace(/\/$/, "")}/accept-vault-invite?token=${encodeURIComponent(token)}`;

  return NextResponse.json({ success: true, url, token, expiresAt: expiresAt.toISOString(), role });
}
