/**
 * Helpers to encrypt / decrypt the per-user "encryptedSecrets" blob
 * stored in `dreyv_connections.encrypted_secrets`.
 *
 * The blob is a JSON object: { fieldName: plaintext, ... }
 * It is sealed as a single AES-256-GCM payload using `KEYPAIR_MASTER_KEY`.
 */

import { encryptKeypair, decryptKeypair } from "@/lib/keypair-envelope";

export function sealSecrets(secrets: Record<string, string>): string {
  const json = JSON.stringify(secrets ?? {});
  return encryptKeypair(json);
}

export function openSecrets(blob: string): Record<string, string> {
  try {
    const json = decryptKeypair(blob);
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
    return {};
  } catch {
    return {};
  }
}
