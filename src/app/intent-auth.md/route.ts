import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * /intent-auth.md — Intent-Scoped Sign-In With Solana.
 *
 * Extends SIWS (Sign-In With Solana, CAIP-122) by binding a
 * natural-language `purpose` to the signed session. The purpose is
 * parsed into a structured intent, hashed, and embedded in both the
 * signed message and the issued JWT — every downstream call is then
 * checked against that scope before execution.
 *
 * Companion to /auth.md (agent auth). This spec is for HUMANS issuing
 * intent-scoped sessions (directly, or delegating to an agent).
 */
export function GET() {
  const origin = getSiteOrigin();

  const body = `# Intent-Auth.md

_Dreyv — Intent-Scoped Sign-In With Solana (v0.1 DRAFT)_

> First-mover spec. Extends SIWS / CAIP-122 by binding a natural-language
> **purpose** to the signed session. The session is only valid for actions
> that match that purpose.

## Why

Standard SIWS proves \`address X signed in at time T\`. It does not say
*what the user intended to do*. Once issued, the bearer token can do
**anything** that address is allowed to do until it expires.

Intent-Auth ties the session to a single, explicit, human-stated purpose
captured in natural language:

> "Rebalance my treasury to 40% USDC for the next 60 minutes, max slippage 0.5%."

The agent (or the user's own client) parses this into a structured
\`Intent\`, hashes it, and includes both the raw text and the hash in the
SIWS message. The server re-parses, re-hashes, and rejects any later
request whose action falls outside the scope.

## Identity types

- **user**   — human signer (wallet holder).
- **agent**  — autonomous delegate executing on the user's behalf.
- **dapp**   — third-party app that requested the session.

## Message format

A SIWS-compatible message with two new mandatory fields: \`Purpose\` and
\`Intent-Hash\`. Field order is fixed (one field per line, blank line
between header block, purpose block, and parameters block).

\`\`\`
${origin} wants you to sign in with your Solana account:
<wallet-address>

<human-readable statement, optional>

Purpose: <free-form natural-language purpose, ≤ 512 chars>
Intent-Hash: <hex sha256(canonical_intent_json)>

URI: ${origin}
Version: 1
Chain ID: solana:mainnet
Nonce: <≥ 8 alphanumeric chars, single-use>
Issued At: <ISO 8601 UTC>
Expiration Time: <ISO 8601 UTC, ≤ Issued At + 24h>
Not Before: <ISO 8601 UTC, optional>
Request ID: <opaque, optional>
Resources:
- intent-auth://v1
- <additional URIs, optional>
\`\`\`

### Field rules

| Field | Required | Notes |
| --- | :-: | --- |
| \`Purpose\` | yes | Plain UTF-8. No newlines. The exact text the user saw and approved. |
| \`Intent-Hash\` | yes | \`sha256(canonical_json(Intent))\` lowercase hex. See *Canonicalization*. |
| \`Resources\` | yes | MUST include \`intent-auth://v1\` so verifiers can detect this profile. |
| \`Expiration Time\` | yes | Hard cap 24h from \`Issued At\`. Recommended ≤ 1h for execute-scope. |
| \`Nonce\` | yes | Single-use, replay-protected server-side for 5 minutes past \`Expiration\`. |

Any other SIWS / EIP-4361-style field (\`Statement\`, \`Request ID\`,
\`Not Before\`) is allowed and MUST be reproduced verbatim during
verification.

## Intent object

The parsed structured form of \`Purpose\`. The hash MUST be computed over
this object — not over the purpose string — so semantically equivalent
phrasings can produce stable scopes.

\`\`\`json
{
  "kind": "trade" | "yield_action" | "treasury_action" | "payment" |
          "monitor" | "research" | "policy_setup" | "navigate",
  "entities": {
    "token"?: "SOL" | "USDC" | "<mint>" | "<symbol>",
    "amount"?: number,
    "amountUsd"?: number,
    "recipient"?: "<address>",
    "protocol"?: "<slug>",
    "chain"?: "solana" | "solana:mainnet" | "solana:devnet"
  },
  "constraints": {
    "slippageMaxPct"?: number,
    "maxNotionalUsd"?: number,
    "deadline"?: "<ISO 8601>",
    "allowlist"?: ["<address>", "..."],
    "denylist"?: ["<address>", "..."],
    "modeFlag"?: "build" | "execute" | "auto"
  },
  "delegate": {
    "agentId"?: "<dreyv agent id or DID>",
    "maxCalls"?: number,
    "ttlSeconds"?: number
  },
  "version": "intent-auth/1"
}
\`\`\`

### Canonicalization (required for \`Intent-Hash\`)

1. Drop keys whose value is \`null\`, \`undefined\`, \`""\`, \`[]\`, or \`{}\`.
2. Sort object keys lexicographically at every depth.
3. Serialize numbers without trailing zeros (\`0.5\` not \`0.50\`).
4. UTF-8 encode, then \`sha256\`, then lowercase hex.

Reference implementation: \`src/lib/auth/intent.ts\` (\`canonicalizeIntent\`,
\`hashIntent\`).

## Endpoints

### \`POST /api/auth/intent/challenge\`

Client posts the raw \`purpose\` string; server returns the parsed Intent,
its canonical hash, and a fully-assembled SIWS message ready to sign.

Request:
\`\`\`json
{ "walletAddress": "<base58>", "purpose": "Rebalance to 40% USDC for 60 minutes" }
\`\`\`

Response:
\`\`\`json
{
  "message": "<full SIWS message above>",
  "intent": { "kind": "yield_action", "...": "..." },
  "intentHash": "<hex>",
  "nonce": "<...>",
  "expiresAt": "<ISO>"
}
\`\`\`

If \`intent.kind === "unknown"\` or \`ambiguities.length > 0\`, the server
returns HTTP 422 with the ambiguities so the client can re-prompt the
user before asking for a signature.

### \`POST /api/auth/intent/verify\`

Client posts the user's signature. Server:

1. Re-parses the embedded \`Purpose\` → recomputes Intent + hash.
2. Asserts \`recomputedHash === Intent-Hash\` field in the message.
3. Verifies the ed25519 signature against \`walletAddress\`.
4. Verifies \`Nonce\` is fresh and single-use.
5. Verifies \`Issued At\` / \`Expiration Time\` window.
6. Upserts the user, issues a JWT.

Request:
\`\`\`json
{ "message": "<full message>", "signature": "<base58>", "walletAddress": "<base58>" }
\`\`\`

Response:
\`\`\`json
{
  "user": { "id": "...", "walletAddress": "..." },
  "session": {
    "expiresAt": "<ISO>",
    "intent": { "...": "..." },
    "intentHash": "<hex>",
    "scopeId": "<short ulid>"
  }
}
\`\`\`

### JWT claims

\`\`\`json
{
  "sub": "<user id>",
  "wallet": "<base58>",
  "method": "intent-siws",
  "iat": 1750000000,
  "exp": 1750003600,
  "iss": "${origin}",
  "scope_hash": "<intent hash>",
  "scope_kind": "yield_action",
  "scope_id": "<ulid>",
  "delegate": { "agentId": "...", "maxCalls": 50 }
}
\`\`\`

The cookie name is \`keystone-intent-session\` (separate from the
unscoped \`keystone-siws-session\` so the two coexist).

## Enforcement

Every protected route MUST call \`assertIntentMatches(req, action)\`
where \`action\` is the route's declared capability (e.g.
\`{ kind: "trade", entities: { token: "SOL", amount: 0.5 } }\`).

Match rules:

1. \`action.kind === intent.kind\` — exact.
2. Every entity in \`action.entities\` must equal the value in
   \`intent.entities\` if that key is present; missing keys in
   \`intent.entities\` mean "any value allowed".
3. \`action.amountUsd ≤ intent.constraints.maxNotionalUsd\` (if set).
4. \`now ≤ intent.constraints.deadline\` (if set).
5. Recipient must be in \`allowlist\` and not in \`denylist\` (if set).
6. \`delegate.maxCalls\` is decremented atomically; refuse on 0.

A mismatch returns HTTP 403 with body
\`{ "error": "intent_scope_mismatch", "expected": <intent>, "actual": <action> }\`
so the client can prompt the user for a new scoped session.

## Revocation

- \`DELETE /api/auth/intent\` — revokes the current cookie.
- \`POST /api/auth/intent/revoke { "scopeId": "..." }\` — revokes a specific
  scope (useful when a user wants to kill one agent's authority without
  signing out themselves).
- Server keeps a revocation set keyed by \`scope_id\` for the duration of
  the longest possible session window (24h).

## Delegation (\`auth.md\` bridge)

When \`intent.delegate.agentId\` is set, the server additionally mints a
short-lived \`dak_intent_…\` key bound to the same \`scope_hash\` and
returns it on \`/verify\`. The agent presents that key on the standard
agent rails described in \`${origin}/auth.md\`. Revoking the human
session revokes the derived agent key.

## Security notes

- The \`Purpose\` line is shown to the user verbatim by the wallet — wallets
  that hide \`Purpose\` MUST be treated as unsafe and rejected client-side.
- Servers MUST reject messages without the \`intent-auth://v1\` resource
  marker so a standard SIWS verifier can never accidentally authorize a
  scoped session as unscoped (or vice versa).
- \`Intent-Hash\` is over the *canonical Intent*, never the raw purpose,
  so a hostile relay cannot rewrite the human-readable purpose without
  invalidating the signature.
- \`Nonce\` reuse, expired \`Issued At\`, and clock skew > 5 min all reject.

## Open questions (v0.1)

- Multi-purpose sessions (array of Intents under one signature)?
- Standard taxonomy for \`kind\` — align with ERC-7521 / EIP-7715 vocab?
- On-chain anchor: optional memo program write of \`scope_hash\` for
  public auditability of delegated agent authority.

## Contact

founders@dreyv.com — feedback welcome; this spec is intentionally a
draft so we can co-evolve it with wallets and other agent platforms.
`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
