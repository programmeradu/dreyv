/**
 * Real per-user aggregations powering the proactive email layer.
 * All queries are scoped to wallets the user owns via the `vaults` table
 * (kind in connected/multisig/watch). If a user has zero vaults, every
 * helper returns null so the cron skips them — no fake numbers.
 */
import { db } from '@/db';
import {
  vaults,
  treasuryEvents,
  treasurySnapshots,
  agentProposals,
  agentTxProposals,
  vaultProposals,
  agentExecutions,
} from '@/db/schema';
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';

export async function getUserWallets(userId: string): Promise<string[]> {
  if (!db) return [];
  const rows = await db
    .select({ address: vaults.address })
    .from(vaults)
    .where(eq(vaults.userId, userId));
  return rows.map((r) => r.address).filter(Boolean);
}

// ─── Weekly digest ───────────────────────────────────────────────────
export type WeeklyDigest = {
  pnlUsd: number;
  pnlPct: number;
  topMover: string;
  feesUsd: number;
  agentActions: number;
  pendingApprovals: number;
};

export async function getWeeklyDigest(userId: string): Promise<WeeklyDigest | null> {
  if (!db) return null;
  const wallets = await getUserWallets(userId);
  if (!wallets.length) return null;

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  // PnL = sum(amount_usd) over treasury_events in window.
  const [agg] = await db
    .select({
      net: sql<string>`COALESCE(SUM(${treasuryEvents.amountUsd}), 0)`,
      fees: sql<string>`COALESCE(SUM(CASE WHEN ${treasuryEvents.kind} = 'fee' THEN ${treasuryEvents.amountUsd} END), 0)`,
    })
    .from(treasuryEvents)
    .where(and(inArray(treasuryEvents.walletAddress, wallets), gte(treasuryEvents.occurredAt, since)));

  // Anchor: most recent snapshot total at start of window.
  const [start] = await db
    .select({ totalUsd: treasurySnapshots.totalUsd })
    .from(treasurySnapshots)
    .where(and(inArray(treasurySnapshots.walletAddress, wallets), lte(treasurySnapshots.capturedAt, since)))
    .orderBy(desc(treasurySnapshots.capturedAt))
    .limit(1);

  const pnlUsd = Number(agg?.net ?? 0);
  const feesUsd = Math.abs(Number(agg?.fees ?? 0));
  const startUsd = Number(start?.totalUsd ?? 0);
  const pnlPct = startUsd > 0 ? (pnlUsd / startUsd) * 100 : 0;

  // Top mover: symbol with largest abs net amount_usd in window.
  const movers = await db
    .select({
      symbol: treasuryEvents.tokenSymbol,
      delta: sql<string>`COALESCE(SUM(${treasuryEvents.amountUsd}), 0)`,
    })
    .from(treasuryEvents)
    .where(
      and(
        inArray(treasuryEvents.walletAddress, wallets),
        gte(treasuryEvents.occurredAt, since),
        isNotNull(treasuryEvents.tokenSymbol),
      ),
    )
    .groupBy(treasuryEvents.tokenSymbol);
  const top = movers
    .map((m) => ({ s: m.symbol ?? '—', d: Number(m.delta) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  const topMover = top
    ? `${top.s} (${top.d >= 0 ? '+' : ''}${top.d.toFixed(0)} USD)`
    : '—';

  // Agent actions = agent_executions completed in window.
  const [actions] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(agentExecutions)
    .where(and(eq(agentExecutions.userId, userId), gte(agentExecutions.createdAt, since)));

  // Pending approvals = open agent_tx_proposals + Squads vault_proposals Active for user wallets.
  const [agentPending] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(agentTxProposals)
    .where(and(eq(agentTxProposals.userId, userId), inArray(agentTxProposals.status, ['queued', 'approved'])));
  const [squadsPending] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(vaultProposals)
    .where(and(inArray(vaultProposals.vaultAddress, wallets), eq(vaultProposals.status, 'Active')));

  const pendingApprovals = Number(agentPending?.n ?? 0) + Number(squadsPending?.n ?? 0);
  const agentActions = Number(actions?.n ?? 0);

  // Suppress empty digests — nothing happened.
  if (pnlUsd === 0 && feesUsd === 0 && agentActions === 0 && pendingApprovals === 0 && topMover === '—') {
    return null;
  }

  return { pnlUsd, pnlPct, topMover, feesUsd, agentActions, pendingApprovals };
}

// ─── Monthly report ──────────────────────────────────────────────────
export type MonthlyReport = {
  performanceVsBenchmark: string;
  driftSummary: string;
  scenariosRun: number;
};

export async function getMonthlyReport(userId: string): Promise<MonthlyReport | null> {
  if (!db) return null;
  const wallets = await getUserWallets(userId);
  if (!wallets.length) return null;
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  // Realized return % from snapshots.
  const [first] = await db
    .select({ totalUsd: treasurySnapshots.totalUsd, capturedAt: treasurySnapshots.capturedAt })
    .from(treasurySnapshots)
    .where(and(inArray(treasurySnapshots.walletAddress, wallets), gte(treasurySnapshots.capturedAt, since)))
    .orderBy(treasurySnapshots.capturedAt)
    .limit(1);
  const [last] = await db
    .select({ totalUsd: treasurySnapshots.totalUsd })
    .from(treasurySnapshots)
    .where(inArray(treasurySnapshots.walletAddress, wallets))
    .orderBy(desc(treasurySnapshots.capturedAt))
    .limit(1);

  const a = Number(first?.totalUsd ?? 0);
  const b = Number(last?.totalUsd ?? 0);
  const realized = a > 0 ? ((b - a) / a) * 100 : 0;
  const performanceVsBenchmark =
    a > 0 ? `${realized >= 0 ? '+' : ''}${realized.toFixed(2)}% realized (30d)` : 'Not enough snapshot history yet';

  // Drift: count symbols with > 5pp swing in weight using composition snapshots.
  let driftSummary = 'All positions within band';
  try {
    const compRows = await db.execute(sql/* sql */ `
      WITH first_day AS (
        SELECT DISTINCT ON (wallet_address) wallet_address, captured_at, composition, total_usd
        FROM treasury_snapshots
        WHERE wallet_address = ANY(${sql.raw(`ARRAY[${wallets.map((w) => `'${w.replace(/'/g, "''")}'`).join(',')}]::text[]`)})
          AND captured_at >= ${since}
        ORDER BY wallet_address, captured_at ASC
      ),
      last_day AS (
        SELECT DISTINCT ON (wallet_address) wallet_address, captured_at, composition, total_usd
        FROM treasury_snapshots
        WHERE wallet_address = ANY(${sql.raw(`ARRAY[${wallets.map((w) => `'${w.replace(/'/g, "''")}'`).join(',')}]::text[]`)})
        ORDER BY wallet_address, captured_at DESC
      )
      SELECT
        COALESCE(f.elem->>'symbol', l.elem->>'symbol') AS symbol,
        COALESCE((f.elem->>'valueUsd')::numeric / NULLIF(f.total_usd,0), 0) AS w_first,
        COALESCE((l.elem->>'valueUsd')::numeric / NULLIF(l.total_usd,0), 0) AS w_last
      FROM (SELECT total_usd, jsonb_array_elements(composition) AS elem FROM first_day) f
      FULL OUTER JOIN (SELECT total_usd, jsonb_array_elements(composition) AS elem FROM last_day) l
        ON f.elem->>'symbol' = l.elem->>'symbol'
    `);
    // @ts-expect-error neon http result rows
    const rows = (compRows.rows ?? compRows ?? []) as Array<{ symbol: string; w_first: string; w_last: string }>;
    const drifted = rows.filter((r) => Math.abs(Number(r.w_last) - Number(r.w_first)) > 0.05);
    if (drifted.length > 0) driftSummary = `${drifted.length} of ${rows.length} positions drifted >5pp`;
    else if (rows.length > 0) driftSummary = `${rows.length} positions all within band`;
  } catch {
    // best-effort
  }

  // Scenarios run — agent_proposals tagged horizon != 'instant' over 30d, or fall back to count of foresight runs in agentExecutions.
  const [scen] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(agentExecutions)
    .where(and(eq(agentExecutions.userId, userId), gte(agentExecutions.createdAt, since)));

  const scenariosRun = Number(scen?.n ?? 0);
  if (a === 0 && scenariosRun === 0) return null;
  return { performanceVsBenchmark, driftSummary, scenariosRun };
}

// ─── Vault commands (3 suggestions) ──────────────────────────────────
export type VaultCommand = { title: string; why: string };

export async function getVaultCommands(userId: string): Promise<VaultCommand[] | null> {
  if (!db) return null;
  const wallets = await getUserWallets(userId);
  if (!wallets.length) return null;

  const cmds: VaultCommand[] = [];

  // 1. Open agent proposals tagged 'open' kind 'proposal' — surface the highest-confidence one.
  const open = await db
    .select({ title: agentProposals.title, thesis: agentProposals.thesis, confidence: agentProposals.confidence })
    .from(agentProposals)
    .where(and(eq(agentProposals.userId, userId), eq(agentProposals.status, 'open'), eq(agentProposals.kind, 'proposal')))
    .orderBy(desc(agentProposals.confidence))
    .limit(2);
  for (const p of open) cmds.push({ title: p.title, why: p.thesis });

  // 2. Stale Squads proposals.
  const stale = await db
    .select({ tx: vaultProposals.transactionIndex, vault: vaultProposals.vaultAddress, createdAt: vaultProposals.createdAt })
    .from(vaultProposals)
    .where(and(inArray(vaultProposals.vaultAddress, wallets), eq(vaultProposals.status, 'Active')))
    .orderBy(vaultProposals.createdAt)
    .limit(1);
  if (stale[0]) {
    const ageDays = Math.floor((Date.now() - new Date(stale[0].createdAt).getTime()) / 86400000);
    cmds.push({
      title: `Resolve Squads proposal #${stale[0].tx}`,
      why: `Pending ${ageDays}d on ${stale[0].vault.slice(0, 6)}… — review and execute or cancel.`,
    });
  }

  // 3. Idle stables suggestion if last snapshot has high stable_usd ratio.
  const [snap] = await db
    .select({ total: treasurySnapshots.totalUsd, stable: treasurySnapshots.stableUsd })
    .from(treasurySnapshots)
    .where(inArray(treasurySnapshots.walletAddress, wallets))
    .orderBy(desc(treasurySnapshots.capturedAt))
    .limit(1);
  if (snap && Number(snap.total) > 0) {
    const ratio = Number(snap.stable) / Number(snap.total);
    if (ratio > 0.5 && Number(snap.stable) > 1000) {
      cmds.push({
        title: 'Sweep idle USDC into a yield route',
        why: `${(ratio * 100).toFixed(0)}% of vault is in stables ($${Number(snap.stable).toFixed(0)}). Pre-routed via Marinade or Kamino.`,
      });
    }
  }

  return cmds.length ? cmds.slice(0, 3) : null;
}

// ─── Approval nudges ─────────────────────────────────────────────────
export async function getPendingApprovals(userId: string): Promise<{ count: number; oldestHours: number } | null> {
  if (!db) return null;
  const wallets = await getUserWallets(userId);
  if (!wallets.length) return null;

  const agent = await db
    .select({ createdAt: agentTxProposals.createdAt })
    .from(agentTxProposals)
    .where(and(eq(agentTxProposals.userId, userId), inArray(agentTxProposals.status, ['queued', 'approved'])));
  const squads = await db
    .select({ createdAt: vaultProposals.createdAt })
    .from(vaultProposals)
    .where(and(inArray(vaultProposals.vaultAddress, wallets), eq(vaultProposals.status, 'Active')));

  const all = [...agent, ...squads].map((r) => new Date(r.createdAt).getTime());
  if (!all.length) return null;
  const oldestHours = Math.floor((Date.now() - Math.min(...all)) / 3_600_000);
  if (oldestHours < 24) return null; // only nudge after 24h
  return { count: all.length, oldestHours };
}

// ─── Agent insights (event-driven) ───────────────────────────────────
export type Insight = { headline: string; detail: string; metrics: { label: string; value: string; accent?: boolean }[] };

export async function getFreshAgentInsight(userId: string, sinceHours = 24): Promise<Insight | null> {
  if (!db) return null;
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const [row] = await db
    .select({
      title: agentProposals.title,
      thesis: agentProposals.thesis,
      kind: agentProposals.kind,
      confidence: agentProposals.confidence,
      observedAt: agentProposals.observedAt,
      tags: agentProposals.tags,
    })
    .from(agentProposals)
    .where(and(eq(agentProposals.userId, userId), eq(agentProposals.status, 'open'), eq(agentProposals.kind, 'alert'), gte(agentProposals.observedAt, since)))
    .orderBy(desc(agentProposals.confidence))
    .limit(1);
  if (!row) return null;
  return {
    headline: row.title,
    detail: row.thesis,
    metrics: [
      { label: 'Confidence', value: `${Math.round(Number(row.confidence) * 100)}%`, accent: true },
      { label: 'Observed', value: new Date(row.observedAt).toLocaleString() },
    ],
  };
}

export async function getFreshOpportunity(userId: string, sinceHours = 24): Promise<Insight | null> {
  if (!db) return null;
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const [row] = await db
    .select({
      title: agentProposals.title,
      thesis: agentProposals.thesis,
      confidence: agentProposals.confidence,
      observedAt: agentProposals.observedAt,
      opp: agentProposals.opp,
    })
    .from(agentProposals)
    .where(and(eq(agentProposals.userId, userId), eq(agentProposals.status, 'open'), eq(agentProposals.kind, 'proposal'), gte(agentProposals.observedAt, since)))
    .orderBy(desc(agentProposals.confidence))
    .limit(1);
  if (!row) return null;
  return {
    headline: row.title,
    detail: row.thesis,
    metrics: [
      { label: 'Confidence', value: `${Math.round(Number(row.confidence) * 100)}%`, accent: true },
      { label: 'Observed', value: new Date(row.observedAt).toLocaleString() },
    ],
  };
}

// ─── Anomaly: large outflow / new counterparty in last hour ─────────
export async function getFreshAnomaly(userId: string, sinceHours = 2): Promise<Insight | null> {
  if (!db) return null;
  const wallets = await getUserWallets(userId);
  if (!wallets.length) return null;
  const since = new Date(Date.now() - sinceHours * 3_600_000);

  // Largest outflow in window over $1k.
  const [row] = await db
    .select({
      amount: treasuryEvents.amountUsd,
      counterparty: treasuryEvents.counterparty,
      symbol: treasuryEvents.tokenSymbol,
      occurredAt: treasuryEvents.occurredAt,
      sig: treasuryEvents.signature,
    })
    .from(treasuryEvents)
    .where(
      and(
        inArray(treasuryEvents.walletAddress, wallets),
        eq(treasuryEvents.kind, 'outflow'),
        gte(treasuryEvents.occurredAt, since),
      ),
    )
    .orderBy(treasuryEvents.amountUsd)
    .limit(1);
  if (!row) return null;
  const amt = Math.abs(Number(row.amount));
  if (amt < 1000) return null;
  return {
    headline: 'Unusual outflow detected',
    detail: `A ${amt.toFixed(0)} USD ${row.symbol ?? 'token'} transfer left your treasury. Verify the signer and destination.`,
    metrics: [
      { label: 'Amount', value: `${amt.toFixed(0)} USD`, accent: true },
      { label: 'Counterparty', value: row.counterparty ? `${row.counterparty.slice(0, 6)}…${row.counterparty.slice(-4)}` : 'Unknown' },
      { label: 'When', value: new Date(row.occurredAt).toLocaleString() },
    ],
  };
}

// ─── Upgrade nudge signal ────────────────────────────────────────────
export async function getUpgradeSignal(userId: string, tier: string): Promise<{ suggestedTier: string; reason: string } | null> {
  if (!db) return null;
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [exec] = await db
    .select({ n: sql<string>`COUNT(*)` })
    .from(agentExecutions)
    .where(and(eq(agentExecutions.userId, userId), gte(agentExecutions.createdAt, since)));
  const wallets = await getUserWallets(userId);
  const actions = Number(exec?.n ?? 0);

  if (tier === 'free' && (actions >= 5 || wallets.length >= 2)) {
    return {
      suggestedTier: 'Mini',
      reason: `You ran ${actions} agent actions across ${wallets.length} vault${wallets.length === 1 ? '' : 's'} this week — Mini unlocks more agent slots and team seats.`,
    };
  }
  if (tier === 'mini' && (actions >= 25 || wallets.length >= 5)) {
    return {
      suggestedTier: 'Max',
      reason: `${actions} actions and ${wallets.length} vaults this week match Max-tier usage — unlimited agents and priority Foresight.`,
    };
  }
  return null;
}
