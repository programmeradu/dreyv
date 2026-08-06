import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";
export const runtime = "edge";

export const dynamic = "force-static";

/**
 * /SKILL.md — npx-skills installable catalog.
 * Matches the shape used by https://solana.com/SKILL.md so devs can run:
 *   npx skills add https://dreyv.com
 * and pull every Dreyv agent skill into Claude / Cursor / Codex.
 */
export function GET() {
  const origin = getSiteOrigin();

  const body = `# Dreyv Agent Skills

> Treasury & agent-payment skills for AI agents building on Solana and EVM.
> Install all skills: \`npx skills add ${origin}\`
> Discovery JSON: ${origin}/.well-known/agent-skills/index.json

## Install All Skills

\`\`\`
npx skills add ${origin}
\`\`\`

## Skills

### Wallet Intel & Portfolio
Paste any Solana or EVM address — get holdings, PnL, risk, story. Read-only, no wallet connection.
- **Category**: Intel
- **Endpoint**: ${origin}/api/mcp (tool: \`wallet_intel\`)

### Rug & Token Forensics
On-chain forensics for any SPL or ERC-20: holder concentration, LP locks, mint authority, simulation firewall.
- **Category**: Security
- **Endpoint**: ${origin}/api/mcp (tool: \`token_risk\`)

### Yield Finder
Best risk-adjusted yield across 40+ Solana + EVM protocols, ranked by audit status and TVL.
- **Category**: DeFi
- **Endpoint**: ${origin}/api/mcp (tool: \`yield_search\`)

### Foresight Simulation
Simulate trades, payouts, or rebalances before signing. Pure simulation — no transactions submitted.
- **Category**: Simulation
- **Endpoint**: ${origin}/api/mcp (tool: \`foresight_simulate\`)

### Agent Payments (x402)
Agents pay per call from a prepaid USDC balance. No human-in-the-loop, capped, killable.
- **Category**: Payments
- **Endpoint**: ${origin}/.well-known/x402

### Agent Wallet & Balance
Auto-provisioned custodial Solana wallet per agent + prepaid credit ledger. Sweep + claim into a human account anytime.
- **Category**: Payments
- **Endpoint**: ${origin}/api/agents/wallet

### Treasury Ops
Payouts, runway, drift, concentration, anomaly alerts for any treasury or multisig (Squads supported).
- **Category**: Treasury
- **Endpoint**: ${origin}/api/mcp (tool: \`treasury_ops\`)

### Execution & Intents
Jupiter swaps, gasless txs, multisig proposals, intent routing. Non-custodial — keys never leave the user's wallet.
- **Category**: Execution
- **Endpoint**: ${origin}/api/mcp (tool: \`execute_intent\`)

### RPC Quick Lookups
Cached, rate-friendly lookups for balances, token metadata, prices, and tx history across Solana + EVM.
- **Category**: Reference
- **Endpoint**: ${origin}/api/v1

### Agent Auth & Onboarding
One-call machine signup, OAuth 2.1 DCR, scoped API keys (\`dk_live_\`, \`dk_test_\`, \`dak_\`).
- **Category**: Auth
- **Endpoint**: ${origin}/auth.md

## Discovery

- MCP:      ${origin}/api/mcp
- OpenAPI:  ${origin}/openapi.json
- ACP:      ${origin}/.well-known/acp.json
- UCP:      ${origin}/.well-known/ucp
- x402:     ${origin}/.well-known/x402
- llms.txt: ${origin}/llms.txt
- Auth:     ${origin}/auth.md

## Contact

founders@dreyv.com
`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
