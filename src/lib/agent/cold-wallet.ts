/**
 * Cold wallet — the high-trust counterpart to the hot agent wallet.
 *
 * Hot/cold split (per Agent-Cred's pattern):
 *   • HOT  (agent_wallets)      — signs scoped, low-limit autonomous txs.
 *   • COLD (agent_cold_wallets) — sweep destination + refill source.
 *     Refills back into HOT require a human-approved action code
 *     (see src/lib/agent/action-codes.ts).
 *
 * One per user. Private key encrypted with KEYPAIR_MASTER_KEY via
 * src/lib/keypair-envelope.ts (same envelope as the hot wallet).
 */

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { decryptKeypair, encryptKeypair } from "@/lib/keypair-envelope";

export interface ColdWalletRecord {
  publicKey: string;
  createdAt: Date;
  secretBase58?: string;
}

export async function getOrCreateColdWallet(
  userId: string,
  opts: { withSecret?: boolean } = {},
): Promise<ColdWalletRecord> {
  if (!db) throw new Error("Database unavailable");

  const existing = await db.execute<{
    public_key: string;
    encrypted_secret: string;
    created_at: Date;
  }>(sql`
    SELECT public_key, encrypted_secret, created_at
      FROM agent_cold_wallets
     WHERE user_id = ${userId}
     LIMIT 1
  `);

  const row = existing.rows[0];
  if (row) {
    return {
      publicKey: row.public_key,
      createdAt: row.created_at,
      secretBase58: opts.withSecret ? decryptKeypair(row.encrypted_secret) : undefined,
    };
  }

  const kp = Keypair.generate();
  const secretBase58 = bs58.encode(kp.secretKey);
  const publicKey = kp.publicKey.toBase58();
  const encrypted = encryptKeypair(secretBase58);

  const inserted = await db.execute<{ created_at: Date }>(sql`
    INSERT INTO agent_cold_wallets (user_id, public_key, encrypted_secret)
    VALUES (${userId}, ${publicKey}, ${encrypted})
    RETURNING created_at
  `);

  return {
    publicKey,
    createdAt: inserted.rows[0]!.created_at,
    secretBase58: opts.withSecret ? secretBase58 : undefined,
  };
}
