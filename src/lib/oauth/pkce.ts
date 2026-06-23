/**
 * PKCE S256 verification (RFC 7636).
 */

import { createHash } from "node:crypto";

export function verifyS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  if (verifier.length < 43 || verifier.length > 128) return false;
  const computed = createHash("sha256").update(verifier, "ascii").digest("base64url");
  // constant-time compare
  if (computed.length !== challenge.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ challenge.charCodeAt(i);
  }
  return diff === 0;
}
