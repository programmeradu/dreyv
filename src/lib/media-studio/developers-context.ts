/**
 * Canonical "Dreyv for developers" context block injected into Media Studio
 * generation prompts. Lets the copy + visual generators talk accurately about
 * the MCP server, REST API, capability surface, auth model, and the demo
 * hooks we want Reddit / X / LinkedIn posts to lead with.
 *
 * Source of truth: src/app/developers/page.tsx + src/app/developers/mcp/page.tsx
 * + src/lib/capabilities/registry.ts. Update this file whenever the public
 * developer surface changes meaningfully.
 */

export const DREYV_DEV_SURFACE = {
  homepage: "https://dreyv.com/developers",
  mcp: "https://dreyv.com/developers/mcp",
  openapi: "https://dreyv.com/openapi.json",
  llmsTxt: "https://dreyv.com/llms.txt",
  authDoc: "https://dreyv.com/auth.md",
  mcpEndpoint: "https://dreyv.com/api/mcp",
  restBase: "https://dreyv.com/api/v1",
  freeTier: "Free tier covers testing — 5,000 calls/day, read-only, no card.",
  auth: "One Bearer key. Non-custodial by design — read-only by default, signing is opt-in and never custodial.",
  surfaces: [
    "MCP server over Streamable HTTP (Claude Desktop, Cursor, ChatGPT, any MCP-aware agent)",
    "Typed REST API with OpenAPI 3.1",
    "x402 agent payments — agents pay per call from a prepaid USDC balance, no human-in-the-loop",
    "ACP / UCP / ai-plugin / llms.txt for agent discoverability",
    "Webhooks + idempotency keys + rate-limited fair-use",
  ],
  capabilityFamilies: [
    "Identity & wallet intel (any Solana or EVM address → portfolio, PnL, story)",
    "Market data (prices, liquidity, route quotes via Jupiter + aggregators)",
    "Risk + forensics (rug detection, holder concentration, simulation firewall)",
    "Yield (40+ protocols ranked by risk-adjusted return)",
    "Treasury ops (payouts, runway, drift, foresight simulation)",
    "Execution (intents, swaps, multisig proposals, gasless)",
    "Agent primitives (prepaid balance, x402, signing layer, watchers, handoffs)",
  ],
  heroHooks: [
    {
      id: "wallet-brain",
      title: "Paste any Solana wallet → Claude tells you the story",
      caps: "intel + portfolio + pnl + risk",
      safety: "Read-only. No wallet connection. No signing.",
    },
    {
      id: "rug-forensics",
      title: "Ask Claude 'is this token a rug?' — actual on-chain forensics, not vibes",
      caps: "security_firewall + risk_assessment + holder_concentration",
      safety: "Read-only. Pure analysis.",
    },
    {
      id: "yield-finder",
      title: "Claude finds the best yield for your stables across 40+ protocols, ranked by risk",
      caps: "yield + risk + tvl + audit_status",
      safety: "Read-only suggestions. Execution is opt-in and non-custodial.",
    },
    {
      id: "self-paying-agent",
      title: "Your agent has a USDC wallet now. It pays per call. You never touch it.",
      caps: "x402 + prepaid balance + agent_wallet",
      safety: "Capped balance, per-call billing, kill-switch on the dashboard.",
    },
    {
      id: "foresight",
      title: "Foresight: 'simulate selling 30% of my SOL at $X' — Claude runs the impact model",
      caps: "foresight_simulation + market_impact",
      safety: "Pure simulation. No transactions submitted.",
    },
  ],
  safetyBlock: [
    "Read-only by default — no wallet connection required.",
    "Non-custodial when signing — keys never leave the user's wallet.",
    "Free tier covers all testing (5,000 calls/day).",
    "Rate-limited and idempotency-keyed at the API edge.",
  ],
} as const;

export function developersContextPrompt(): string {
  const d = DREYV_DEV_SURFACE;
  const hooks = d.heroHooks
    .map((h, i) => `  ${i + 1}. ${h.title}\n     caps: ${h.caps}\n     safety: ${h.safety}`)
    .join("\n");
  return [
    `DREYV DEVELOPERS SURFACE (use this when the brief mentions developers, MCP, API, agents, Claude, Cursor, ChatGPT, x402, or building):`,
    ``,
    `Public URLs:`,
    `  - Developers hub: ${d.homepage}`,
    `  - MCP server page: ${d.mcp}`,
    `  - MCP endpoint: ${d.mcpEndpoint}`,
    `  - REST base: ${d.restBase}`,
    `  - OpenAPI: ${d.openapi}`,
    `  - llms.txt: ${d.llmsTxt}`,
    `  - Auth: ${d.authDoc}`,
    ``,
    `Auth + access:`,
    `  - ${d.auth}`,
    `  - ${d.freeTier}`,
    ``,
    `Surfaces:`,
    ...d.surfaces.map((s) => `  - ${s}`),
    ``,
    `Capability families (300+ typed capabilities total):`,
    ...d.capabilityFamilies.map((c) => `  - ${c}`),
    ``,
    `Approved demo hooks (lead with one of these when the brief is generic):`,
    hooks,
    ``,
    `Safety block (reuse near the end of any post about agents/wallets):`,
    ...d.safetyBlock.map((s) => `  - ${s}`),
    ``,
    `Rules when writing about developers:`,
    `  - The pitch surface is the developer URLs above. Do NOT pitch the dreyv.com app shell.`,
    `  - Never invent capabilities, partner names, or metrics not in this block or the user brief.`,
    `  - Prefer concrete prompts a reader can paste into Claude/Cursor over abstract claims.`,
    `  - Keep the non-custodial + read-only-by-default framing visible — it kills the safety objection.`,
  ].join("\n");
}
