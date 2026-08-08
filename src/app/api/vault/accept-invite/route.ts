export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teams, teamMembers, teamInvitations, teamActivityLog, vaults } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";
import { eq, and } from "drizzle-orm";

/**
 * POST /api/vault/accept-invite { token }
 *
 * Binds the authenticated wallet to the team that owns the invited vault.
 * Also registers the vault for this user so it shows up in their workspace.
 * Returns { vaultAddress, teamId, role } so the client can auto-connect.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const token = String(body.token || "").trim();
  if (!token) return NextResponse.json({ error: "Missing invite token" }, { status: 400 });

  const [invite] = await db
    .select()
    .from(teamInvitations)
    .where(eq(teamInvitations.token, token))
    .limit(1);
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (invite.acceptedAt) return NextResponse.json({ error: "Invite already used" }, { status: 410 });
  if (new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  // Look up the team + vault address
  const [team] = await db.select().from(teams).where(eq(teams.id, invite.teamId)).limit(1);
  if (!team || !team.vaultAddress) {
    return NextResponse.json({ error: "Team or vault missing" }, { status: 410 });
  }

  // Add membership (active) — idempotent on (teamId,userId)
  const existing = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(teamMembers).values({
      teamId: team.id,
      userId: user.id,
      walletAddress: user.walletAddress,
      role: invite.role,
      invitedBy: invite.invitedBy,
      acceptedAt: new Date(),
      status: "active",
    });
  } else {
    await db
      .update(teamMembers)
      .set({ status: "active", acceptedAt: new Date(), role: invite.role })
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)));
  }

  // Register the vault on the invitee's account if not already (best-effort, ignore conflicts)
  try {
    await db.insert(vaults).values({
      userId: user.id,
      teamId: team.id,
      address: team.vaultAddress,
      label: team.name || "Shared Vault",
      isMultisig: true,
    }).onConflictDoNothing();
  } catch { /* unique-on-address is intentional */ }

  // Mark invite consumed
  await db
    .update(teamInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(teamInvitations.id, invite.id));

  await db.insert(teamActivityLog).values({
    teamId: team.id,
    userId: user.id,
    action: "member_joined",
    description: `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)} accepted vault invite`,
  });

  return NextResponse.json({
    success: true,
    vaultAddress: team.vaultAddress,
    teamId: team.id,
    role: invite.role,
  });
}
