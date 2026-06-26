/**
 * Dreyv ed25519 attestations (Solana Attestation Service-compatible).
 *
 * We sign a canonical JSON envelope with the issuer ed25519 key
 * (ATTESTATION_SIGNING_KEY_BASE58, falls back to KORA_PAYMASTER_SECRET_BASE58
 * if attestation key not explicitly configured). The signature is verifiable
 * by anyone given the issuer pubkey + the canonical claims string.
 *
 * Wire compatibility: the envelope intentionally mirrors the offchain
 * "credential" shape used by the Solana Attestation Service so SAS
 * clients can ingest Dreyv-issued credentials directly.
 */

import nacl from "tweetnacl";
import bs58 from "bs58";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export interface AttestationClaims {
  [key: string]: unknown;
}

export interface Attestation {
  id: string;
  schema: string;
  subject: { user_id?: string | null; wallet?: string | null };
  claims: AttestationClaims;
  issuer: string;            // ed25519 pubkey base58
  signature: string;         // base64 ed25519 sig over canonical_payload
  issued_at: string;         // ISO
  expires_at: string | null;
  revoked_at: string | null;
  canonical_payload: string; // exact bytes that were signed
}

export interface IssuerInfo {
  available: boolean;
  pubkey: string | null;
  algorithm: "ed25519";
  reason?: string;
}

let cachedSigner: nacl.SignKeyPair | null = null;

function loadSigner(): nacl.SignKeyPair | null {
  if (cachedSigner) return cachedSigner;
  const explicit = process.env.ATTESTATION_SIGNING_KEY_BASE58?.trim();
  const fallback = process.env.KORA_PAYMASTER_SECRET_BASE58?.trim();
  const secret = explicit || fallback;
  if (!secret) return null;
  try {
    const decoded = bs58.decode(secret);
    // tweetnacl expects a 64-byte secret key (seed + pubkey)
    if (decoded.length === 64) {
      cachedSigner = nacl.sign.keyPair.fromSecretKey(decoded);
    } else if (decoded.length === 32) {
      cachedSigner = nacl.sign.keyPair.fromSeed(decoded);
    } else {
      return null;
    }
    return cachedSigner;
  } catch {
    return null;
  }
}

export function getIssuerInfo(): IssuerInfo {
  const signer = loadSigner();
  if (!signer) {
    return { available: false, pubkey: null, algorithm: "ed25519", reason: "issuer_unconfigured" };
  }
  return {
    available: true,
    pubkey: bs58.encode(signer.publicKey),
    algorithm: "ed25519",
  };
}

/**
 * Canonical JSON — sorted keys, no whitespace. This is what we sign and
 * what any verifier must reconstruct to verify.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") +
    "}"
  );
}

export interface IssueArgs {
  schema: string;
  subject: { user_id?: string | null; wallet?: string | null };
  claims: AttestationClaims;
  expires_at?: Date | null;
}

export async function issueAttestation(args: IssueArgs): Promise<Attestation> {
  const signer = loadSigner();
  if (!signer) throw new Error("issuer_unconfigured");
  if (!db) throw new Error("db_unavailable");
  if (!args.subject.user_id && !args.subject.wallet) {
    throw new Error("subject_required");
  }

  const issuedAt = new Date();
  const expiresAt = args.expires_at ?? null;
  const issuerPubkey = bs58.encode(signer.publicKey);

  const payload = {
    schema: args.schema,
    subject: {
      user_id: args.subject.user_id ?? null,
      wallet: args.subject.wallet ?? null,
    },
    claims: args.claims,
    issuer: issuerPubkey,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt ? expiresAt.toISOString() : null,
  };
  const canonical = canonicalize(payload);
  const sigBytes = nacl.sign.detached(Buffer.from(canonical, "utf8"), signer.secretKey);
  const signature = Buffer.from(sigBytes).toString("base64");

  const rows = await db.execute(sql`
    INSERT INTO agent_attestations (subject_user_id, subject_wallet, schema, claims, issuer, signature, issued_at, expires_at)
    VALUES (
      ${args.subject.user_id ?? null}::uuid,
      ${args.subject.wallet ?? null}::text,
      ${args.schema}::text,
      ${JSON.stringify(args.claims)}::jsonb,
      ${issuerPubkey}::text,
      ${signature}::text,
      ${issuedAt.toISOString()}::timestamptz,
      ${expiresAt ? expiresAt.toISOString() : null}::timestamptz
    )
    RETURNING id
  `);
  const id = (rows as unknown as { rows: Array<{ id: string }> }).rows[0].id;

  return {
    id,
    schema: args.schema,
    subject: { user_id: args.subject.user_id ?? null, wallet: args.subject.wallet ?? null },
    claims: args.claims,
    issuer: issuerPubkey,
    signature,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    revoked_at: null,
    canonical_payload: canonical,
  };
}

export async function getAttestationById(id: string): Promise<Attestation | null> {
  if (!db) throw new Error("db_unavailable");
  const rows = await db.execute(sql`
    SELECT id, subject_user_id, subject_wallet, schema, claims, issuer, signature, issued_at, expires_at, revoked_at
      FROM agent_attestations WHERE id = ${id}::uuid LIMIT 1
  `);
  const r = (rows as unknown as { rows: Array<Record<string, unknown>> }).rows[0];
  if (!r) return null;
  const subject = {
    user_id: (r.subject_user_id as string | null) ?? null,
    wallet: (r.subject_wallet as string | null) ?? null,
  };
  const claims = (r.claims as AttestationClaims) ?? {};
  const issuedAt = new Date(r.issued_at as string).toISOString();
  const expiresAt = r.expires_at ? new Date(r.expires_at as string).toISOString() : null;
  const canonical = canonicalize({
    schema: r.schema,
    subject,
    claims,
    issuer: r.issuer,
    issued_at: issuedAt,
    expires_at: expiresAt,
  });
  return {
    id: r.id as string,
    schema: r.schema as string,
    subject,
    claims,
    issuer: r.issuer as string,
    signature: r.signature as string,
    issued_at: issuedAt,
    expires_at: expiresAt,
    revoked_at: r.revoked_at ? new Date(r.revoked_at as string).toISOString() : null,
    canonical_payload: canonical,
  };
}

export type VerifyResult =
  | { ok: true; attestation: Attestation }
  | { ok: false; reason: "not_found" | "bad_signature" | "expired" | "revoked" | "issuer_mismatch" };

export async function verifyAttestationById(id: string): Promise<VerifyResult> {
  const att = await getAttestationById(id);
  if (!att) return { ok: false, reason: "not_found" };
  if (att.revoked_at) return { ok: false, reason: "revoked" };
  if (att.expires_at && new Date(att.expires_at) < new Date()) {
    return { ok: false, reason: "expired" };
  }
  const issuerKey = bs58.decode(att.issuer);
  const sig = Buffer.from(att.signature, "base64");
  const ok = nacl.sign.detached.verify(
    Buffer.from(att.canonical_payload, "utf8"),
    sig,
    issuerKey,
  );
  if (!ok) return { ok: false, reason: "bad_signature" };
  return { ok: true, attestation: att };
}

export function verifyDetached(args: {
  canonical_payload: string;
  signature_b64: string;
  issuer_pubkey_base58: string;
}): boolean {
  try {
    const sig = Buffer.from(args.signature_b64, "base64");
    const pk = bs58.decode(args.issuer_pubkey_base58);
    return nacl.sign.detached.verify(Buffer.from(args.canonical_payload, "utf8"), sig, pk);
  } catch {
    return false;
  }
}
