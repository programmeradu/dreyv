/**
 * One-Time Action Codes — the human approval primitive.
 *
 * Flow:
 *   1. Agent calls POST /api/agents/action-codes with { intent, description,
 *      amount_minor? }. Returns { id, expires_at, approval_url }.
 *      The 6-digit code is NEVER returned to the agent — only stored as a hash
 *      and shown to the human at the approval URL.
 *   2. Human opens approval_url, sees the request, clicks Approve (or rejects).
 *   3. Agent polls GET /api/agents/action-codes/:id and sees status=approved.
 *   4. Agent passes the id back into the action it wanted to take. The
 *      downstream route calls `consumeApprovedCode(id, userId, intent)` which
 *      atomically flips status to "consumed" (single-use).
 *
 * Lifetime: 10 minutes. Codes expire on read; expired codes can't be approved.
 */

import { createHash, randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";

const CODE_TTL_MS = 10 * 60 * 1000;

export interface MintArgs {
  userId: string;
  apiKeyId?: string | null;
  intent: string;
  description: string;
  amountMinor?: bigint | null;
  currency?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MintedCode {
  id: string;
  /** Plaintext 6-digit code. Only returned ONCE, in the API response shown to the human. */
  code: string;
  approvalUrl: string;
  expiresAt: Date;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

function pickCode(): string {
  // 6-digit zero-padded, cryptographically random.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function mintActionCode(args: MintArgs, origin: string): Promise<MintedCode> {
  if (!db) throw new Error("Database unavailable");
  const code = pickCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  const res = await db.execute<{ id: string }>(sql`
    INSERT INTO agent_action_codes
      (user_id, api_key_id, code_hash, intent, description, amount_minor, currency, metadata, expires_at)
    VALUES (${args.userId}, ${args.apiKeyId ?? null}, ${codeHash}, ${args.intent},
            ${args.description}, ${args.amountMinor?.toString() ?? null},
            ${args.currency ?? null}, ${JSON.stringify(args.metadata ?? {})}::jsonb, ${expiresAt})
    RETURNING id
  `);

  const id = res.rows[0]!.id;
  return {
    id,
    code,
    approvalUrl: `${origin.replace(/\/+$/, "")}/app/approve/${id}`,
    expiresAt,
  };
}

export interface CodeStatus {
  id: string;
  intent: string;
  description: string;
  amountMinor: string | null;
  currency: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "consumed";
  expiresAt: Date;
  approvedAt: Date | null;
  consumedAt: Date | null;
}

export async function getCodeStatus(id: string, userId: string): Promise<CodeStatus | null> {
  if (!db) return null;
  const res = await db.execute<{
    id: string;
    intent: string;
    description: string;
    amount_minor: string | null;
    currency: string | null;
    status: CodeStatus["status"];
    expires_at: Date;
    approved_at: Date | null;
    consumed_at: Date | null;
  }>(sql`
    SELECT id, intent, description, amount_minor::text, currency, status,
           expires_at, approved_at, consumed_at
      FROM agent_action_codes
     WHERE id = ${id} AND user_id = ${userId}
     LIMIT 1
  `);
  const r = res.rows[0];
  if (!r) return null;
  // Lazy expiry on read.
  if (r.status === "pending" && r.expires_at.getTime() < Date.now()) {
    await db.execute(sql`UPDATE agent_action_codes SET status='expired' WHERE id=${id}`);
    r.status = "expired";
  }
  return {
    id: r.id,
    intent: r.intent,
    description: r.description,
    amountMinor: r.amount_minor,
    currency: r.currency,
    status: r.status,
    expiresAt: r.expires_at,
    approvedAt: r.approved_at,
    consumedAt: r.consumed_at,
  };
}

/**
 * Human-side approval. The user types the 6-digit code shown to the agent
 * (defence-in-depth against open redirects / clickjacking on the approval URL).
 */
export async function approveCode(args: {
  id: string;
  userId: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!db) return { ok: false, reason: "db_unavailable" };
  const codeHash = hashCode(args.code);
  const res = await db.execute<{ status: string }>(sql`
    UPDATE agent_action_codes
       SET status = 'approved', approved_at = now()
     WHERE id = ${args.id}
       AND user_id = ${args.userId}
       AND code_hash = ${codeHash}
       AND status = 'pending'
       AND expires_at > now()
     RETURNING status
  `);
  if (res.rows[0]) return { ok: true };
  return { ok: false, reason: "invalid_or_expired" };
}

export async function rejectCode(id: string, userId: string): Promise<boolean> {
  if (!db) return false;
  const res = await db.execute<{ id: string }>(sql`
    UPDATE agent_action_codes
       SET status = 'rejected'
     WHERE id = ${id} AND user_id = ${userId} AND status = 'pending'
     RETURNING id
  `);
  return res.rows.length > 0;
}

/**
 * Atomic single-use consumption — call from the downstream action that the
 * code was approving. Intent must match what was minted.
 */
export async function consumeApprovedCode(args: {
  id: string;
  userId: string;
  intent: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!db) return { ok: false, reason: "db_unavailable" };
  const res = await db.execute<{ id: string }>(sql`
    UPDATE agent_action_codes
       SET status = 'consumed', consumed_at = now()
     WHERE id = ${args.id}
       AND user_id = ${args.userId}
       AND intent = ${args.intent}
       AND status = 'approved'
       AND expires_at > now()
     RETURNING id
  `);
  if (res.rows[0]) return { ok: true };
  return { ok: false, reason: "not_approved_or_expired" };
}
