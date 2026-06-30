/**
 * Pre-funded agent balance — "metered prepaid" payment rail.
 *
 * Agents top up once (Stripe one-time, x402, or manual crypto) and
 * capabilities `chargeAgentBalance()` per call. On insufficient funds,
 * capabilities should return 402 with the top-up URL so the agent can
 * forward the request to its operator (or settle autonomously via x402).
 *
 * USDC minor units throughout (6 decimals). 1 USDC = 1_000_000.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

export const USDC_DECIMALS = 6;
export const TOPUP_MIN_USD = 5;
export const TOPUP_MAX_USD = 10_000;

/**
 * Starter grant — every new agent gets a free trial allowance so the very
 * first capability call doesn't 402 on a 0 balance. $0.25 = 250 calls at
 * the default $0.001/call price. Idempotent via (reason, ref) unique idx.
 */
export const STARTER_GRANT_USD = 0.25;
export const STARTER_GRANT_MINOR = BigInt(Math.round(STARTER_GRANT_USD * 1_000_000));


export type BalanceRow = {
  balance_minor: bigint;
  currency: string;
  updated_at: Date;
};

export function usdToMinor(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("invalid_amount");
  return BigInt(Math.round(usd * 1_000_000));
}

export function minorToUsd(minor: bigint): string {
  const whole = minor / BigInt(1_000_000);
  const frac = (minor % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}.00`;
}

/**
 * If `userId` is an absorbed agent, resolve to the surviving customer's user id
 * by following users.merged_into_user_id. Walks the chain (max 8 hops to avoid
 * any pathological cycle) so chained merges still settle on the live owner.
 */
export async function resolveBalanceOwner(userId: string): Promise<string> {
  if (!db) throw new Error("db_unavailable");
  let current = userId;
  for (let i = 0; i < 8; i++) {
    const rows = await db.execute(sql`
      SELECT merged_into_user_id::text AS next
        FROM users
       WHERE id = ${current}::uuid
       LIMIT 1
    `);
    const r = (rows as unknown as { rows: Array<{ next: string | null }> }).rows[0];
    if (!r || !r.next) return current;
    current = r.next;
  }
  return current;
}

export async function getAgentBalance(userId: string): Promise<BalanceRow> {
  if (!db) throw new Error("db_unavailable");
  const owner = await resolveBalanceOwner(userId);
  // Upsert-on-read so the row always exists.
  const rows = await db.execute(sql`
    INSERT INTO agent_balances (user_id) VALUES (${owner}::uuid)
    ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
    RETURNING balance_minor, currency, updated_at
  `);
  const r = (rows as unknown as { rows: Array<{ balance_minor: string | number; currency: string; updated_at: Date }> }).rows[0];
  return {
    balance_minor: BigInt(r.balance_minor),
    currency: r.currency,
    updated_at: new Date(r.updated_at),
  };
}

export type CreditResult = { ok: true; balance_after: bigint } | { ok: false; reason: "duplicate" | "db_error" };

/**
 * Atomically credit `amountMinor` USDC to user. Idempotent on (reason, ref):
 * a duplicate (reason, ref) returns ok=false reason='duplicate' WITHOUT
 * crediting twice — safe to call from webhook retries.
 */
export async function creditAgentBalance(args: {
  userId: string;
  amountMinor: bigint;
  reason: string;
  ref: string | null;
}): Promise<CreditResult> {
  if (!db) throw new Error("db_unavailable");
  if (args.amountMinor <= BigInt(0)) throw new Error("invalid_amount");
  const owner = await resolveBalanceOwner(args.userId);

  try {
    const result = await db.execute(sql`
      WITH upd AS (
        INSERT INTO agent_balances (user_id, balance_minor, updated_at)
        VALUES (${owner}::uuid, ${args.amountMinor.toString()}::bigint, now())
        ON CONFLICT (user_id) DO UPDATE
          SET balance_minor = agent_balances.balance_minor + EXCLUDED.balance_minor,
              updated_at    = now()
        RETURNING balance_minor
      )
      INSERT INTO agent_balance_ledger (user_id, delta_minor, balance_after, reason, ref)
      SELECT ${owner}::uuid, ${args.amountMinor.toString()}::bigint, balance_minor, ${args.reason}, ${args.ref}
      FROM upd
      RETURNING balance_after
    `);
    const row = (result as unknown as { rows: Array<{ balance_after: string | number }> }).rows[0];
    return { ok: true, balance_after: BigInt(row.balance_after) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("agent_balance_ledger_reason_ref_uniq")) {
      return { ok: false, reason: "duplicate" };
    }
    throw err;
  }
}

/**
 * Seed a one-time free starter grant for a new agent. Idempotent — the
 * ledger's UNIQUE(reason, ref) means a second call returns { ok:false,
 * reason:"duplicate" } without crediting twice. Callers should treat
 * "duplicate" as "already granted, no balance change" and move on.
 */
export async function ensureStarterGrant(userId: string): Promise<CreditResult> {
  return creditAgentBalance({
    userId,
    amountMinor: STARTER_GRANT_MINOR,
    reason: "starter_grant",
    ref: userId,
  });
}


export type ChargeResult =
  | { ok: true; balance_after: bigint }
  | { ok: false; reason: "insufficient"; balance_minor: bigint; required_minor: bigint };

/**
 * Atomically deduct `amountMinor` USDC. Single SQL statement so the
 * CHECK (balance_minor >= 0) constraint is what enforces "no overdraft" —
 * concurrent charges are safe under Postgres MVCC.
 */
export async function chargeAgentBalance(args: {
  userId: string;
  amountMinor: bigint;
  reason: string;
  ref: string | null;
}): Promise<ChargeResult> {
  if (!db) throw new Error("db_unavailable");
  if (args.amountMinor <= BigInt(0)) throw new Error("invalid_amount");

  try {
    const result = await db.execute(sql`
      WITH upd AS (
        UPDATE agent_balances
           SET balance_minor = balance_minor - ${args.amountMinor.toString()}::bigint,
               updated_at = now()
         WHERE user_id = ${args.userId}::uuid
         RETURNING balance_minor
      )
      INSERT INTO agent_balance_ledger (user_id, delta_minor, balance_after, reason, ref)
      SELECT ${args.userId}::uuid, ${(-args.amountMinor).toString()}::bigint, balance_minor, ${args.reason}, ${args.ref}
      FROM upd
      RETURNING balance_after
    `);
    const rows = (result as unknown as { rows: Array<{ balance_after: string | number }> }).rows;
    if (!rows[0]) {
      // No row updated → no balance row exists yet → insufficient.
      const cur = await getAgentBalance(args.userId);
      return { ok: false, reason: "insufficient", balance_minor: cur.balance_minor, required_minor: args.amountMinor };
    }
    return { ok: true, balance_after: BigInt(rows[0].balance_after) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("agent_balances_balance_minor_check") || msg.toLowerCase().includes("check constraint")) {
      const cur = await getAgentBalance(args.userId);
      return { ok: false, reason: "insufficient", balance_minor: cur.balance_minor, required_minor: args.amountMinor };
    }
    throw err;
  }
}
