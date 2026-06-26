/**
 * Dreyv Keychain — a single uniform signing interface across every wallet
 * backend supported by the platform. Mirrors the contract used by the
 * Solana Foundation's "Keychain" tool (local key / KMS / HSM / wallet),
 * so external systems can treat Dreyv as one more signer backend.
 *
 * Currently shipped backends:
 *   - custodial: the per-user agent wallet (server-side ed25519)
 *
 * Foundation-laid (returns 501 with setup hints until enabled):
 *   - turnkey:  TURNKEY_API_PRIVATE_KEY + ORG id
 *   - squads:   Squads multisig proposal flow (write-only — needs caller
 *               wallet to co-sign)
 */

import nacl from "tweetnacl";
import bs58 from "bs58";
import { getOrCreateAgentWallet, keypairFromBase58 } from "@/lib/agent/wallet";

export type KeychainBackend = "custodial" | "turnkey" | "squads";

export interface BackendInfo {
  id: KeychainBackend;
  label: string;
  description: string;
  available: boolean;
  reason?: string;
  capabilities: Array<"sign_message" | "sign_transaction" | "propose">;
  pubkey?: string | null;
}

export async function listBackends(userId: string): Promise<BackendInfo[]> {
  const out: BackendInfo[] = [];

  // Custodial — always available once the user has signed up.
  try {
    const w = await getOrCreateAgentWallet(userId);
    out.push({
      id: "custodial",
      label: "Dreyv custodial wallet",
      description:
        "Per-user ed25519 keypair encrypted at rest (AES-256-GCM). Signs without any human step. Use for autonomous agents.",
      available: true,
      pubkey: w.publicKey,
      capabilities: ["sign_message", "sign_transaction"],
    });
  } catch (err) {
    out.push({
      id: "custodial",
      label: "Dreyv custodial wallet",
      description: "Per-user ed25519 keypair.",
      available: false,
      reason: err instanceof Error ? err.message : "wallet_unavailable",
      capabilities: ["sign_message", "sign_transaction"],
    });
  }

  // Turnkey — embedded wallets / KMS. Available iff Turnkey env is set.
  const turnkeyConfigured =
    !!process.env.TURNKEY_API_PRIVATE_KEY &&
    !!process.env.TURNKEY_API_PUBLIC_KEY &&
    !!process.env.TURNKEY_ORGANIZATION_ID;
  out.push({
    id: "turnkey",
    label: "Turnkey embedded / KMS",
    description:
      "Turnkey-backed signer (KMS-managed ed25519). Use when policy requires that no plaintext secret ever exists on Dreyv infra.",
    available: turnkeyConfigured,
    reason: turnkeyConfigured ? undefined : "turnkey_unconfigured",
    capabilities: ["sign_message", "sign_transaction"],
  });

  // Squads — multisig proposal (not a direct signer).
  out.push({
    id: "squads",
    label: "Squads multisig",
    description:
      "Routes the request as a Squads multisig proposal. Returns a proposal handle; execution requires the configured threshold of human co-signers.",
    available: true,
    capabilities: ["propose"],
  });

  return out;
}

export interface SignArgs {
  userId: string;
  backend: KeychainBackend;
  /** base64 bytes to sign. For sign_transaction this is the serialized tx message; for sign_message it's raw bytes. */
  message_b64: string;
  intent: "sign_message" | "sign_transaction";
}

export interface SignResult {
  backend: KeychainBackend;
  pubkey: string;
  signature_b64: string;
  signature_base58: string;
  algorithm: "ed25519";
}

export async function sign(args: SignArgs): Promise<SignResult> {
  if (args.backend === "custodial") {
    const w = await getOrCreateAgentWallet(args.userId, { withSecret: true });
    if (!w.secretBase58) throw new Error("custodial_secret_unavailable");
    const kp = keypairFromBase58(w.secretBase58);
    const message = Buffer.from(args.message_b64, "base64");
    const sig = nacl.sign.detached(message, kp.secretKey);
    return {
      backend: "custodial",
      pubkey: w.publicKey,
      signature_b64: Buffer.from(sig).toString("base64"),
      signature_base58: bs58.encode(sig),
      algorithm: "ed25519",
    };
  }

  if (args.backend === "turnkey") {
    throw new Error(
      "turnkey_unconfigured: set TURNKEY_API_PRIVATE_KEY / TURNKEY_API_PUBLIC_KEY / TURNKEY_ORGANIZATION_ID, then re-call",
    );
  }
  if (args.backend === "squads") {
    throw new Error(
      "squads_requires_proposal: use POST /api/squads/propose with multisigPda + transactionIndex; this endpoint cannot sign synchronously",
    );
  }
  throw new Error("unknown_backend");
}
