/**
 * Per-user spend caps for the hot agent wallet.
 *
 * Three knobs:
 *   per_tx_max_minor    — single autonomous tx ceiling.
 *   per_day_max_minor   — rolling 24h sum ceiling.
 *   require_code_above  — any single charge ≥ this requires an
 *                         approved action code (see action-codes.ts).
 *
 * All amounts are in USDC minor units (6dp). Defaults applied lazily
 * on first read so existing users don't need a backfill.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface WalletCaps {
  perTxMaxMinor: bigint;
  perDayMaxMinor: bigint;
  requireCodeAboveMinor: bigint;
}

const DEFAULTS: WalletCaps = {
  perTxMaxMinor: BigInt(50_000_000),    // $50
  perDayMaxMinor: BigInt(200_000_000),  // $200
  requireCodeAboveMinor: BigInt(25_000_000), // $25
};

export async function getWalletCaps(userId: string): Promise<WalletCaps> {
  if (!db) return DEFAULTS;
  const res = await db.execute<{
    per_tx_max_minor: string;
    per_day_max_minor: string;
    require_code_above: string;
  }>(sql`
    SELECT per_tx_max_minor::text, per_day_max_minor::text, require_code_above::text
      FROM agent_wallet_caps WHERE user_id = ${userId} LIMIT 1
  `);
  const r = res.rows[0];
  if (!r) return DEFAULTS;
  return {
    perTxMaxMinor: BigInt(r.per_tx_max_minor),
    perDayMaxMinor: BigInt(r.per_day_max_minor),
    requireCodeAboveMinor: BigInt(r.require_code_above),
  };
}

export async function setWalletCaps(
  userId: string,
  patch: Partial<WalletCaps>,
): Promise<WalletCaps> {
  if (!db) throw new Error("Database unavailable");
  const current = await getWalletCaps(userId);
  const next: WalletCaps = {
    perTxMaxMinor: patch.perTxMaxMinor ?? current.perTxMaxMinor,
    perDayMaxMinor: patch.perDayMaxMinor ?? current.perDayMaxMinor,
    requireCodeAboveMinor: patch.requireCodeAboveMinor ?? current.requireCodeAboveMinor,
  };
  await db.execute(sql`
    INSERT INTO agent_wallet_caps (user_id, per_tx_max_minor, per_day_max_minor, require_code_above, updated_at)
    VALUES (${userId}, ${next.perTxMaxMinor.toString()}::bigint,
            ${next.perDayMaxMinor.toString()}::bigint,
            ${next.requireCodeAboveMinor.toString()}::bigint, now())
    ON CONFLICT (user_id) DO UPDATE SET
      per_tx_max_minor = EXCLUDED.per_tx_max_minor,
      per_day_max_minor = EXCLUDED.per_day_max_minor,
      require_code_above = EXCLUDED.require_code_above,
      updated_at = now()
  `);
  return next;
}

/**
 * Sum of debit amounts (negative deltas) against the prepaid balance
 * ledger in the last 24h. Cheap proxy for "autonomous spend today".
 */
export async function getSpendLast24hMinor(userId: string): Promise<bigint> {
  if (!db) return BigInt(0);
  const res = await db.execute<{ sum: string | null }>(sql`
    SELECT COALESCE(SUM(-(delta_minor::bigint))::text, '0') AS sum
      FROM agent_balance_ledger
     WHERE user_id = ${userId}
       AND delta_minor::bigint < 0
       AND created_at > now() - interval '24 hours'
  `);
  return BigInt(res.rows[0]?.sum ?? "0");
}

export type CapDecision =
  | { ok: true }
  | { ok: false; reason: "exceeds_per_tx" | "exceeds_per_day" | "requires_action_code"; caps: WalletCaps; spent24h: bigint };

export async function evaluateCaps(args: {
  userId: string;
  amountMinor: bigint;
  hasApprovedCode?: boolean;
}): Promise<CapDecision> {
  const caps = await getWalletCaps(args.userId);
  if (args.amountMinor > caps.perTxMaxMinor) {
    return { ok: false, reason: "exceeds_per_tx", caps, spent24h: BigInt(0) };
  }
  const spent = await getSpendLast24hMinor(args.userId);
  if (spent + args.amountMinor > caps.perDayMaxMinor) {
    return { ok: false, reason: "exceeds_per_day", caps, spent24h: spent };
  }
  if (!args.hasApprovedCode && args.amountMinor >= caps.requireCodeAboveMinor) {
    return { ok: false, reason: "requires_action_code", caps, spent24h: spent };
  }
  return { ok: true };
}
