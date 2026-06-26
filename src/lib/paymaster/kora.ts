/**
 * Dreyv Kora-compatible paymaster.
 *
 * Lets agents submit a Solana transaction WITHOUT holding any SOL. Dreyv's
 * paymaster keypair signs as the fee payer, broadcasts the tx, and debits
 * the agent's prepaid USDC balance for the lamport fee converted to USDC
 * at SOL_USD_RATE (env-overridable), plus a small markup.
 *
 * Spec parity: matches the request shape used by Kora's /sponsor endpoint
 * (https://github.com/solana-foundation/kora) so existing Kora clients can
 * point at Dreyv with no code change beyond the URL + Bearer token.
 *
 * Operator setup:
 *   KORA_PAYMASTER_SECRET_BASE58   – base58 ed25519 secret key (64 bytes)
 *   KORA_PAYMASTER_MARKUP_BPS      – fee surcharge in bps (default 1000 = 10%)
 *   KORA_SOL_USD_RATE              – conversion rate (default 200)
 *   KORA_MAX_FEE_LAMPORTS          – per-tx cap (default 50_000)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getAgentConnection } from "@/lib/agent/wallet";
import { chargeAgentBalance, getAgentBalance } from "@/lib/agent/balance";
import { db } from "@/db";
import { sql } from "drizzle-orm";

const SOL_LAMPORTS = 1_000_000_000;

export interface PaymasterInfo {
  available: boolean;
  publicKey: string | null;
  network: string;
  markup_bps: number;
  sol_usd_rate: number;
  max_fee_lamports: number;
  reason?: string;
}

let cachedKeypair: Keypair | null = null;

export function getPaymasterKeypair(): Keypair | null {
  if (cachedKeypair) return cachedKeypair;
  const secret = process.env.KORA_PAYMASTER_SECRET_BASE58?.trim();
  if (!secret) return null;
  try {
    cachedKeypair = Keypair.fromSecretKey(bs58.decode(secret));
    return cachedKeypair;
  } catch {
    return null;
  }
}

export function getPaymasterInfo(): PaymasterInfo {
  const kp = getPaymasterKeypair();
  return {
    available: !!kp,
    publicKey: kp ? kp.publicKey.toBase58() : null,
    network: process.env.KORA_NETWORK?.trim() || "solana-mainnet",
    markup_bps: Number(process.env.KORA_PAYMASTER_MARKUP_BPS ?? 1000),
    sol_usd_rate: Number(process.env.KORA_SOL_USD_RATE ?? 200),
    max_fee_lamports: Number(process.env.KORA_MAX_FEE_LAMPORTS ?? 50_000),
    reason: kp ? undefined : "paymaster_unconfigured",
  };
}

export function lamportsToUsdcMinor(lamports: bigint, info = getPaymasterInfo()): bigint {
  // (lamports / 1e9) * SOL_USD * 1e6 = lamports * SOL_USD * 1e-3
  const usdMicroPerLamport = (info.sol_usd_rate * 1_000_000) / SOL_LAMPORTS;
  const baseMinor = BigInt(Math.ceil(Number(lamports) * usdMicroPerLamport));
  // Apply markup
  const withMarkup = (baseMinor * BigInt(10_000 + info.markup_bps)) / BigInt(10_000);
  return withMarkup;
}

export interface SponsorResult {
  signature: string;
  fee_lamports: string;
  charged_minor: string;
  charged_usd: string;
  paymaster: string;
}

export interface SponsorArgs {
  userId: string;
  apiKeyId?: string | null;
  /** Base64-encoded serialized transaction. Can be a legacy Transaction or VersionedTransaction. */
  transaction_b64: string;
  /** When set, refuse to sponsor if the projected USDC charge exceeds this cap (USDC minor units). */
  max_charge_minor?: bigint;
}

interface PreparedTx {
  kind: "legacy" | "versioned";
  legacy?: Transaction;
  versioned?: VersionedTransaction;
  feePayer: PublicKey;
}

function decodeTx(b64: string, paymaster: PublicKey): PreparedTx {
  const raw = Buffer.from(b64, "base64");
  // Try versioned first.
  try {
    const v = VersionedTransaction.deserialize(raw);
    // Fee payer is the first static account key.
    const firstAccount = v.message.staticAccountKeys[0];
    if (!firstAccount.equals(paymaster)) {
      throw new Error("versioned_tx_fee_payer_mismatch: must be paymaster pubkey");
    }
    return { kind: "versioned", versioned: v, feePayer: paymaster };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("versioned_tx_fee_payer_mismatch")) throw err;
    // fall through to legacy
  }
  const legacy = Transaction.from(raw);
  if (!legacy.feePayer) {
    legacy.feePayer = paymaster;
  } else if (!legacy.feePayer.equals(paymaster)) {
    throw new Error("legacy_tx_fee_payer_mismatch: must be paymaster pubkey or unset");
  }
  return { kind: "legacy", legacy, feePayer: paymaster };
}

async function probeFee(conn: Connection, prepared: PreparedTx): Promise<bigint> {
  if (prepared.kind === "versioned" && prepared.versioned) {
    const msg = prepared.versioned.message;
    const fee = await conn.getFeeForMessage(msg, "confirmed");
    return BigInt(fee.value ?? 5_000);
  }
  if (prepared.legacy) {
    if (!prepared.legacy.recentBlockhash) {
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      prepared.legacy.recentBlockhash = blockhash;
    }
    const msg = prepared.legacy.compileMessage();
    const fee = await conn.getFeeForMessage(msg, "confirmed");
    return BigInt(fee.value ?? 5_000);
  }
  return BigInt(5_000);
}

export async function sponsorTransaction(args: SponsorArgs): Promise<SponsorResult> {
  const kp = getPaymasterKeypair();
  if (!kp) throw new Error("paymaster_unconfigured");

  const info = getPaymasterInfo();
  const conn = getAgentConnection();
  const prepared = decodeTx(args.transaction_b64, kp.publicKey);

  // Estimate fee + pre-charge BEFORE submitting, so insufficient balance
  // never burns a real on-chain submission.
  const feeLamports = await probeFee(conn, prepared);
  if (Number(feeLamports) > info.max_fee_lamports) {
    throw new Error(`fee_exceeds_cap: ${feeLamports} > ${info.max_fee_lamports}`);
  }
  const chargeMinor = lamportsToUsdcMinor(feeLamports, info);
  if (args.max_charge_minor && chargeMinor > args.max_charge_minor) {
    throw new Error(`charge_exceeds_max_charge_minor: ${chargeMinor} > ${args.max_charge_minor}`);
  }

  // Idempotency: prepaid_balance debit is keyed by tx signature, but we
  // don't have the signature yet — use a per-attempt UUID, then reconcile
  // by recording the signature in paymaster_sponsorships.
  const attemptRef = `pmstr:attempt:${crypto.randomUUID()}`;
  const charge = await chargeAgentBalance({
    userId: args.userId,
    amountMinor: chargeMinor,
    reason: "paymaster_fee",
    ref: attemptRef,
  });
  if (!charge.ok) {
    const current = await getAgentBalance(args.userId);
    throw new Error(
      `insufficient_balance: have ${current.balance_minor} need ${chargeMinor}`,
    );
  }

  // Sign as fee payer.
  let serialized: Buffer;
  if (prepared.kind === "versioned" && prepared.versioned) {
    prepared.versioned.sign([kp]);
    serialized = Buffer.from(prepared.versioned.serialize());
  } else if (prepared.legacy) {
    prepared.legacy.partialSign(kp);
    serialized = prepared.legacy.serialize({ requireAllSignatures: false });
  } else {
    throw new Error("internal_decode_error");
  }

  let signature: string;
  try {
    signature = await conn.sendRawTransaction(serialized, {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: "confirmed",
    });
  } catch (err) {
    // Refund the user — the tx never made it on-chain.
    await refundCharge(args.userId, chargeMinor, attemptRef);
    throw err;
  }

  // Persist the sponsorship row (status=submitted). A background confirm
  // pass can flip status to confirmed/failed; we don't block the agent on it.
  if (db) {
    await db.execute(sql`
      INSERT INTO paymaster_sponsorships (user_id, api_key_id, signature, fee_lamports, charged_minor, markup_minor, status)
      VALUES (${args.userId}::uuid, ${args.apiKeyId ?? null}::uuid, ${signature}, ${feeLamports.toString()}::text, ${chargeMinor.toString()}::text, ${info.markup_bps.toString()}::text, 'submitted')
      ON CONFLICT (signature) DO NOTHING
    `);
  }

  return {
    signature,
    fee_lamports: feeLamports.toString(),
    charged_minor: chargeMinor.toString(),
    charged_usd: (Number(chargeMinor) / 1_000_000).toFixed(6),
    paymaster: kp.publicKey.toBase58(),
  };
}

async function refundCharge(userId: string, amountMinor: bigint, ref: string) {
  try {
    const { creditAgentBalance } = await import("@/lib/agent/balance");
    await creditAgentBalance({
      userId,
      amountMinor,
      reason: "paymaster_refund",
      ref: ref + ":refund",
    });
  } catch {
    // Best-effort refund — operator will need to reconcile on failure.
  }
}
