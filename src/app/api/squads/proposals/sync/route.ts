export const runtime = "edge";
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { vaultProposals, teams, teamMembers, teamActivityLog, users } from '@/db/schema';
import { SquadsClient } from '@/lib/squads';
import { Connection } from '@solana/web3.js';
import { getAuthUser } from '@/lib/auth-utils';
import { and, asc, desc, eq, inArray, sql as sqlOp } from 'drizzle-orm';

/**
 * Squads proposal mirror sync.
 *
 *   POST /api/squads/proposals/sync   { vaultAddress: string }
 *     → Pull live state from chain, upsert into vault_proposals.
 *   GET  /api/squads/proposals/sync?vault=<address>
 *     → Read cached mirror rows (fast, no RPC hit).
 *
 * The mirror lets the War Room render approval counts, signer lists, and
 * timelines without hammering the Solana RPC on every render.
 */

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

async function assertCallerCanRead(req: NextRequest, vaultAddress: string) {
  const user = await getAuthUser(req);
  if (!user) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (!db) return { ok: false as const, status: 503, error: 'Database unavailable' };

  // Caller must belong to a team that owns this vault address.
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.vaultAddress, vaultAddress))
    .limit(1);

  if (!team) {
    // Vault not attached to a team — anyone authenticated can sync (the
    // mirror is keyed by chain state, not team RBAC). Return null teamId.
    return { ok: true as const, user, teamId: null as string | null };
  }

  const [membership] = await db
    .select({ role: teamMembers.role, status: teamMembers.status })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)))
    .limit(1);

  if (!membership || membership.status !== 'active') {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  return { ok: true as const, user, teamId: team.id };
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const vaultAddress = String(body?.vaultAddress || '').trim();
  if (!vaultAddress) return NextResponse.json({ error: 'vaultAddress required' }, { status: 400 });

  const auth = await assertCallerCanRead(req, vaultAddress);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const client = new SquadsClient(connection, null);
    const liveProposals: any[] = await client.getProposals(vaultAddress);

    // Fetch existing rows up-front so we can detect first-time observations
    // (and emit team_activity_log rows for those) without extra round-trips.
    const liveTxIndexes = liveProposals
      .map((p) => Number(p.transactionIndex ?? p.index ?? p.id ?? 0))
      .filter((n) => Number.isFinite(n));
    const existingRows = liveTxIndexes.length
      ? await db
          .select({
            transactionIndex: vaultProposals.transactionIndex,
            createdBy: vaultProposals.createdBy,
            status: vaultProposals.status,
          })
          .from(vaultProposals)
          .where(
            and(
              eq(vaultProposals.vaultAddress, vaultAddress),
              inArray(vaultProposals.transactionIndex, liveTxIndexes),
            ),
          )
      : [];
    const existingByIndex = new Map<number, { createdBy: string | null; status: string }>();
    for (const r of existingRows) {
      existingByIndex.set(r.transactionIndex, {
        createdBy: (r.createdBy as string | null) ?? null,
        status: r.status,
      });
    }

    let upserted = 0;
    const activityRows: Array<{
      teamId: string | null;
      userId: string | null;
      walletAddress: string | null;
      vaultAddress: string;
      action: string;
      targetType: string;
      targetId: string;
      description: string;
      details: any;
    }> = [];

    // Resolve proposer wallets → userIds in one pass so the activity log can
    // attribute to a Dreyv user when one exists. Skip the lookup for indexes
    // we've already logged, since we only emit `proposal_created` for new rows.
    const proposerWallets = Array.from(
      new Set(
        liveProposals
          .map((p) => (p?.proposer ? String(p.proposer) : null))
          .filter((w): w is string => Boolean(w)),
      ),
    );
    const walletToUserId = new Map<string, string>();
    if (proposerWallets.length) {
      const userRows = await db
        .select({ id: users.id, walletAddress: users.walletAddress })
        .from(users)
        .where(inArray(users.walletAddress, proposerWallets));
      for (const u of userRows) {
        if (u.walletAddress) walletToUserId.set(u.walletAddress, u.id);
      }
    }

    for (const p of liveProposals) {
      const txIndex = Number(p.transactionIndex ?? p.index ?? p.id ?? 0);
      if (!Number.isFinite(txIndex)) continue;

      const status = String(p.status ?? p.state ?? 'Active');
      const approvedBy = Array.isArray(p.approved) ? p.approved : [];
      const rejectedBy = Array.isArray(p.rejected) ? p.rejected : [];
      const approvals = Number(p.approvals ?? approvedBy.length ?? 0);
      const rejections = Number(p.rejections ?? rejectedBy.length ?? 0);
      const threshold = Number(p.threshold ?? 1);
      const proposer: string | null = p.proposer ?? null;

      await db
        .insert(vaultProposals)
        .values({
          vaultAddress,
          teamId: auth.teamId,
          transactionIndex: txIndex,
          status,
          approvals,
          rejections,
          threshold,
          approvedBy,
          rejectedBy,
          summary: p.summary ?? null,
          raw: p,
          createdBy: proposer,
          executedAt: status === 'Executed' ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [vaultProposals.vaultAddress, vaultProposals.transactionIndex],
          set: {
            status,
            approvals,
            rejections,
            threshold,
            approvedBy,
            rejectedBy,
            raw: p,
            // Only stamp createdBy if the existing row is missing one — never
            // overwrite a populated initiator with null on a later sync that
            // failed to decode the transaction account.
            ...(proposer
              ? { createdBy: sqlOp`COALESCE(${vaultProposals.createdBy}, ${proposer})` }
              : {}),
            updatedAt: new Date(),
            ...(status === 'Executed' ? { executedAt: new Date() } : {}),
          },
        });
      upserted++;

      const existing = existingByIndex.get(txIndex);
      if (!existing) {
        activityRows.push({
          teamId: auth.teamId,
          userId: proposer ? walletToUserId.get(proposer) ?? null : null,
          walletAddress: proposer,
          vaultAddress,
          action: 'proposal_created',
          targetType: 'proposal',
          targetId: String(txIndex),
          description: `Proposal #${txIndex} created${proposer ? ` by ${proposer.slice(0, 4)}…${proposer.slice(-4)}` : ''}`,
          details: { proposalIndex: txIndex, status, threshold, txKind: p.txKind ?? null },
        });
      }
    }

    if (activityRows.length) {
      try {
        await db.insert(teamActivityLog).values(activityRows);
      } catch (logErr) {
        console.warn('[squads sync] activity log insert failed', logErr);
      }
    }

    return NextResponse.json({ ok: true, upserted, newProposals: activityRows.length });
  } catch (e: any) {
    console.error('[squads sync] failed', e);
    return NextResponse.json({ error: e?.message || 'sync_failed' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const vaultAddress = req.nextUrl.searchParams.get('vault');
  if (!vaultAddress) return NextResponse.json({ error: 'vault required' }, { status: 400 });

  const auth = await assertCallerCanRead(req, vaultAddress);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const rows = await db
    .select()
    .from(vaultProposals)
    .where(eq(vaultProposals.vaultAddress, vaultAddress))
    .orderBy(desc(vaultProposals.transactionIndex))
    .limit(100);

  return NextResponse.json({ proposals: rows });
}
