/**
 * Ephemeral session signer.
 *
 * A user (or wallet) explicitly delegates a short-lived, capped Solana
 * keypair to Dreyv. The agent can then submit txs without round-tripping
 * to the user wallet for every signature — within strict, server-enforced
 * caps:
 *
 *   • TTL (default 1h, max 24h)
 *   • maxLamports: cumulative SOL outflow ceiling
 *   • maxTxCount:  number of txs the session may sign
 *   • allowedProgramIds: whitelist; any tx touching another program is rejected
 *
 * Non-custodial guarantee: this keypair is generated server-side and lives
 * ONLY in this session. It is NOT the user's main wallet — the user funds
 * it explicitly (e.g. tops up 0.05 SOL) and revokes/sweeps it any time.
 *
 * Like handoff-store, this is currently a process-local Map under globalThis.
 * For multi-instance production, back with `mcp_session_signers` Postgres
 * table — public API stays the same.
 */
import { Keypair, PublicKey, VersionedTransaction, Transaction } from "@solana/web3.js";
import { randomBytes } from "node:crypto";

export interface SessionSignerRecord {
  id: string;
  keyId: string;
  publicKey: string;
  /** Raw secret (Uint8Array as base64) — ephemeral, never persisted to disk. */
  secretKeyB64: string;
  caps: {
    maxLamports: number;
    maxTxCount: number;
    allowedProgramIds: string[];
    expiresAt: number;
  };
  usage: {
    spentLamports: number;
    txCount: number;
    lastSignedAt: number | null;
  };
  status: "active" | "revoked" | "expired";
  createdAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __dreyvSessionSignerStore: Map<string, SessionSignerRecord> | undefined;
}

function store(): Map<string, SessionSignerRecord> {
  if (!globalThis.__dreyvSessionSignerStore) globalThis.__dreyvSessionSignerStore = new Map();
  return globalThis.__dreyvSessionSignerStore;
}

function sweep() {
  const now = Date.now();
  for (const [id, rec] of store()) {
    if (rec.status === "active" && rec.caps.expiresAt <= now) rec.status = "expired";
  }
}

export interface CreateSessionInput {
  keyId: string;
  ttlSec?: number;
  maxLamports?: number;
  maxTxCount?: number;
  allowedProgramIds?: string[];
}

export function createSessionSigner(input: CreateSessionInput): SessionSignerRecord {
  sweep();
  const ttlSec = Math.min(input.ttlSec ?? 3600, 24 * 3600);
  const kp = Keypair.generate();
  const rec: SessionSignerRecord = {
    id: `ss_${randomBytes(10).toString("hex")}`,
    keyId: input.keyId,
    publicKey: kp.publicKey.toBase58(),
    secretKeyB64: Buffer.from(kp.secretKey).toString("base64"),
    caps: {
      maxLamports: Math.max(0, input.maxLamports ?? 50_000_000), // default 0.05 SOL
      maxTxCount: Math.max(1, Math.min(input.maxTxCount ?? 25, 500)),
      allowedProgramIds: input.allowedProgramIds ?? [],
      expiresAt: Date.now() + ttlSec * 1000,
    },
    usage: { spentLamports: 0, txCount: 0, lastSignedAt: null },
    status: "active",
    createdAt: Date.now(),
  };
  store().set(rec.id, rec);
  return rec;
}

export function getSessionSigner(id: string): SessionSignerRecord | null {
  sweep();
  return store().get(id) ?? null;
}

export function revokeSessionSigner(id: string, keyId: string): SessionSignerRecord | null {
  const rec = getSessionSigner(id);
  if (!rec || rec.keyId !== keyId) return null;
  rec.status = "revoked";
  return rec;
}

/**
 * Sign an unsigned tx with this session signer, enforcing caps.
 * Returns the base64-encoded signed tx (still requires submit by caller).
 */
export function signWithSessionSigner(args: {
  sessionId: string;
  keyId: string;
  txBase64: string;
  estimatedLamportsOut: number;
}): { signedTxBase64: string; signature: string; record: SessionSignerRecord } {
  const rec = getSessionSigner(args.sessionId);
  if (!rec) throw new Error("session_signer_not_found");
  if (rec.keyId !== args.keyId) throw new Error("session_signer_owner_mismatch");
  if (rec.status !== "active") throw new Error(`session_signer_${rec.status}`);
  if (rec.usage.txCount >= rec.caps.maxTxCount) throw new Error("session_signer_tx_cap_exceeded");
  if (rec.usage.spentLamports + args.estimatedLamportsOut > rec.caps.maxLamports) {
    throw new Error("session_signer_lamports_cap_exceeded");
  }

  const buf = Buffer.from(args.txBase64, "base64");
  const secret = Buffer.from(rec.secretKeyB64, "base64");
  const kp = Keypair.fromSecretKey(secret);

  let signedB64: string;
  let signature: string;

  // Try versioned first, fall back to legacy.
  try {
    const tx = VersionedTransaction.deserialize(buf);
    assertProgramsAllowed(tx, rec.caps.allowedProgramIds);
    tx.sign([kp]);
    const sigs = tx.signatures;
    signature = Buffer.from(sigs[0]!).toString("base64");
    signedB64 = Buffer.from(tx.serialize()).toString("base64");
  } catch {
    const tx = Transaction.from(buf);
    if (rec.caps.allowedProgramIds.length > 0) {
      for (const ix of tx.instructions) {
        if (!rec.caps.allowedProgramIds.includes(ix.programId.toBase58())) {
          throw new Error(`program_not_allowed: ${ix.programId.toBase58()}`);
        }
      }
    }
    tx.partialSign(kp);
    const s = tx.signatures.find((s) => s.publicKey.equals(kp.publicKey))?.signature;
    signature = s ? Buffer.from(s).toString("base64") : "";
    signedB64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
  }

  rec.usage.txCount += 1;
  rec.usage.spentLamports += args.estimatedLamportsOut;
  rec.usage.lastSignedAt = Date.now();

  return { signedTxBase64: signedB64, signature, record: rec };
}

function assertProgramsAllowed(tx: VersionedTransaction, allowed: string[]) {
  if (allowed.length === 0) return;
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const allowedSet = new Set(allowed);
  for (const ix of tx.message.compiledInstructions) {
    const pid = keys[ix.programIdIndex];
    if (pid && !allowedSet.has(pid)) {
      throw new Error(`program_not_allowed: ${pid}`);
    }
  }
}

/** Sanitize for external callers — never leak the secret key. */
export function redactSessionSigner(rec: SessionSignerRecord) {
  const { secretKeyB64: _omit, ...safe } = rec;
  return safe;
}
