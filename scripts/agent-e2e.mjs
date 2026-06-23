#!/usr/bin/env node
/**
 * End-to-end agent conformance test.
 *
 * Runs the full pipeline against a target origin:
 *   1. Discovery
 *   2. Machine signup
 *   3. ACP checkout (x402 path, dry-run unless --pay)
 *   4. Mint a scoped key
 *   5. List keys
 *   6. Revoke the minted key
 *
 * Usage:
 *   node scripts/agent-e2e.mjs https://dreyv.com
 */

const origin = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const log = (label, data) => console.log(`\n→ ${label}\n  `, data);

async function jget(path) {
  const r = await fetch(`${origin}${path}`);
  log(`GET ${path}`, `${r.status} ${r.headers.get("content-type") ?? ""}`);
  return r;
}
async function jpost(path, body, headers = {}) {
  const r = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  log(`POST ${path}`, `${r.status}`);
  return r;
}

const main = async () => {
  // 1. Discovery
  for (const p of [
    "/.well-known/acp.json",
    "/.well-known/x402",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/.well-known/http-message-signatures-directory",
    "/auth.md",
  ]) {
    const r = await jget(p);
    if (!r.ok) throw new Error(`discovery missing: ${p}`);
  }

  // 2. Signup
  const signup = await jpost("/api/agents/signup", {
    client_name: "e2e-bot",
    owner_did: "did:web:example.com",
  });
  const reg = await signup.json();
  if (!signup.ok) throw new Error(`signup failed: ${JSON.stringify(reg)}`);
  log("signup", { user_id: reg.user_id, client_id: reg.client_id, scopes: reg.scopes });
  const apiKey = reg.api_key;

  // 3. ACP checkout — request x402 challenge (no payment header yet)
  const checkout = await jpost(
    "/api/acp/checkout",
    { tier: "mini", payment: { provider: "x402" } },
    { Authorization: `Bearer ${apiKey}` },
  );
  if (checkout.status !== 402) throw new Error(`expected 402, got ${checkout.status}`);
  const challenge = await checkout.json();
  log("checkout challenge", challenge.accepts?.[0]);

  // 4. Mint a narrower scoped key
  const minted = await jpost(
    "/api/keys",
    { label: "e2e child key", scopes: ["read:treasury", "read:market"] },
    { Authorization: `Bearer ${apiKey}` },
  );
  const mintedBody = await minted.json();
  if (!minted.ok) throw new Error(`mint failed: ${JSON.stringify(mintedBody)}`);
  log("minted", { id: mintedBody.key.id, prefix: mintedBody.key.keyPrefix });

  // 5. List
  const list = await fetch(`${origin}/api/keys`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const listBody = await list.json();
  log("list", { count: listBody.keys?.length });

  // 6. Revoke
  const del = await fetch(`${origin}/api/keys/${mintedBody.key.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  log("revoke", del.status);

  console.log("\n✓ e2e ok");
};

main().catch((e) => {
  console.error("\n✗ e2e failed:", e.message);
  process.exit(1);
});
