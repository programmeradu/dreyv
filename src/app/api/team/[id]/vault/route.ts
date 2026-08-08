export const runtime = "edge";
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { teams, teamMembers, teamActivityLog } from '@/db/schema';
import { getAuthUser } from '@/lib/auth-utils';
import { and, eq } from 'drizzle-orm';

/**
 * PATCH /api/team/[id]/vault
 * Body: { vaultAddress: string, threshold?: number, signers?: string[] }
 *
 * Persist a freshly-created Squads multisig PDA against a team.
 * Only owners/admins may attach a vault.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const { id: teamId } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const vaultAddress = String(body?.vaultAddress || '').trim();
  if (!vaultAddress || vaultAddress.length < 32) {
    return NextResponse.json({ error: 'vaultAddress is required (base58 PDA)' }, { status: 400 });
  }

  // Authorization: caller must be owner or admin in this team
  const [membership] = await db
    .select({ role: teamMembers.role, status: teamMembers.status })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))
    .limit(1);

  if (!membership || membership.status !== 'active') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only owners or admins can attach a vault' }, { status: 403 });
  }

  try {
    const [updated] = await db
      .update(teams)
      .set({ vaultAddress })
      .where(eq(teams.id, teamId))
      .returning();

    // Best-effort activity log
    try {
      await db.insert(teamActivityLog).values({
        teamId,
        userId: user.id,
        action: 'vault_attached',
        targetType: 'vault',
        description: `Attached Squads multisig ${vaultAddress.slice(0, 6)}…${vaultAddress.slice(-4)}`,
      });
    } catch {
      // log table may have different shape across branches; non-fatal
    }

    return NextResponse.json({ team: updated });
  } catch (e: any) {
    console.error('[team vault attach] failed', e);
    return NextResponse.json({ error: e?.message || 'Failed to attach vault' }, { status: 500 });
  }
}
