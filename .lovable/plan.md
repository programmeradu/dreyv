
# Dreyv Web3 API + MCP — The Ultimate Agentic Web3 Interface

Goal: ship **one product with two faces** — a REST/JSON API (`api.dreyv.com`) and a fully spec-compliant MCP server (`mcp.dreyv.com`) — that any human dev, agent framework (Claude, Cursor, ChatGPT, LangGraph, AI SDK), or autonomous agent can plug into. We don't out-RPC Alchemy; we out-*think* them: simulation, agentic reasoning, forensics, intent routing, x402 native payments, and treasury intelligence layered on top of every primitive.

## Positioning (from the 35-layer research)

The Web3 API/MCP landscape today:
- **Solved well**: raw RPC (Alchemy/Helius/QuickNode/dRPC), prices (CoinGecko/Pyth), basic NFT (Reservoir), basic swap (0x/Jupiter/1inch), bridges (LiFi/Wormhole), portfolio reads (Zerion/DeBank).
- **Solved poorly or not at all** — Dreyv's wedge:
  1. Cross-chain **unified namespace** (ENS+SNS+Basenames+NEAR+Lens as one resolver)
  2. **Simulation as a universal primitive** (every write tool has dry-run with structured diffs, risk flags, honeypot/rug detection)
  3. **MEV-protected submission** as default (Flashbots/MEV Blocker/Jito auto-routing)
  4. **Intent routing** across UniswapX, CoW, Across, 1inch Fusion+, LiFi simultaneously (ERC-7683)
  5. **On-chain forensics** (sanctions, mixer exposure, wash trade, counterparty graph) as first-class tools
  6. **Treasury / multisig intelligence** (Squads + Safe pending props, simulate, queue, vote)
  7. **x402-native payment-gated tools** + scoped agent keys (`dak_`)
  8. **EAS attestations** on every tool call → verifiable agent action log
  9. **A2A delegation** (ERC-8004 identity, scoped session keys via EIP-7702)
  10. **Dreyv signature layers**: agentic reasoning, foresight simulator, narratives, edge-insights, knowledge memory, watchers — none of which exist in any competing API/MCP.

## Architecture

```text
                ┌──────────────────────────────────────────┐
                │     Dreyv Capability Registry (single)   │
                │   capability spec = REST + MCP + types   │
                └──────────────┬───────────────────────────┘
                               │ one source of truth
            ┌──────────────────┼──────────────────────────┐
            ▼                  ▼                          ▼
   /api/v1/* (REST)    /mcp (Streamable HTTP)     SDK (@dreyv/sdk)
   dk_live_… bearer    OAuth2.1 + dk_live_…       typed wrappers
   per-route scopes    tools auto-generated       browser + node
            │                  │                          │
            └────────┬─────────┴────────────┬─────────────┘
                     ▼                      ▼
        ┌────────────────────┐   ┌────────────────────────┐
        │  Read plane        │   │  Write plane           │
        │ Helius/Alchemy/    │   │ Simulation-first →     │
        │ Jupiter/LiFi/      │   │ MEV-protected submit → │
        │ DefiLlama/Pyth/    │   │ EAS attestation →      │
        │ Bitquery/Nansen    │   │ x402 settlement        │
        └────────────────────┘   └────────────────────────┘
                     │                      │
                     └──────────┬───────────┘
                                ▼
                    ┌─────────────────────────┐
                    │  Dreyv Signature Layer  │
                    │  - Foresight Simulator  │
                    │  - Agentic reasoning    │
                    │  - Forensics + risk     │
                    │  - Narratives/insights  │
                    │  - Watchers + alerts    │
                    │  - Treasury brain       │
                    └─────────────────────────┘
```

## Key (un-negotiable) design rules

- **One registry, two transports.** Every capability is declared once in `src/lib/capabilities/registry.ts` with Zod input/output + scope + pricing. REST routes and MCP tools are *generated* from it. No drift.
- **`dk_live_…` becomes a real key.** Hashed in `api_keys` table, bearer auth, scopes (`read:portfolio`, `read:treasury`, `read:market`, `read:forensics`, `write:simulate`, `write:intent`, `pay:x402`, `agent:delegate`), per-key rate limits, last-used, revocation.
- **`dak_…` stays payment-only.** No reshuffling existing x402 logic.
- **Simulation-first everywhere.** Any write tool returns `{ simulation, signedAction }`; submission is a second call. No surprises for agents.
- **MEV by default.** Solana → Jito tip + staked Helius; EVM → Flashbots Protect / MEV Blocker. Caller can opt out with `mevProtection: 'off'`.
- **Brand voice in narratives.** Calm, precise; banned words enforced server-side on AI-generated strings.

## The 35 layers (capability map)

Grouped into 7 pillars × 5 layers. Each layer = 3–10 tools. Implementation is incremental; pillars 1–3 ship first.

### Pillar A — Identity & Resolution
1. **Universal name resolver** — `resolve(identifier)` covering ENS, SNS, Basenames, NEAR, Lens, Farcaster, .sol, .eth
2. **Entity profile** — merge of Nansen labels, Arkham tags, on-chain history, social handles
3. **Agent identity** — ERC-8004 registration + lookup, Dreyv-issued agent passports
4. **Capability delegation** — EIP-7702 session keys with spend caps + TTL
5. **Wallet metadata** — first-seen, dormancy, classification (EOA/contract/CEX/bridge)

### Pillar B — Portfolio & Treasury (Dreyv signature)
6. **Unified portfolio** — multi-chain holdings (reuse `/api/helius/das/wallet-holdings` + `/api/evm/holdings`)
7. **PnL + cost basis** — wraps `/api/public/pnl` + tax-lot engine (FIFO/LIFO/HIFO)
8. **DeFi positions** — Kamino/Marinade/Jito/Aave/Compound (Zerion-grade for Solana that nobody has)
9. **Treasury health** — runway, diversification, concentration risk (reuse analytics endpoints)
10. **Multisig intelligence** — Squads + Safe pending props, `simulate_safe_tx`, queue, vote (reuse `/api/squads/*`)

### Pillar C — Market & Discovery
11. **Best price oracle** — Pyth + Jupiter + CoinGecko fallback with confidence
12. **OHLCV + trending** — Birdeye/Jupiter/Bitquery normalized
13. **Token forensics** — rug, mint/freeze auth, holder concentration (reuse `/api/solana/rug-check` + `/api/public/token/[mint]`)
14. **DeFi yields** — DefiLlama + yield-scanner normalized + Dreyv risk scoring
15. **New listings / discovery** — DexScreener + Jupiter trending + AI ranking

### Pillar D — Execution (simulation-first, MEV-protected)
16. **Simulate transaction** — universal: Tenderly for EVM, Helius `simulateTransaction` for Solana, structured diff
17. **Intent express** — ERC-7683 fan-out across UniswapX/CoW/Across/1inch Fusion+/LiFi
18. **Bridge** — LiFi + deBridge + Wormhole, return ranked routes
19. **Swap** — Jupiter (SOL) + 0x (EVM) with Permit2
20. **Submit with MEV protection** — auto-route to Jito bundle / Flashbots Protect

### Pillar E — Forensics & Compliance (huge gap — Dreyv signature)
21. **Sanctions check** — OFAC + UN + EU lists, cached
22. **Mixer exposure** — Tornado/Samourai depth score (reuse risk endpoint)
23. **Counterparty graph** — multi-hop fund flow (reuse `/api/public/counterparties`)
24. **Wash trade detection** — statistical on token + window
25. **Composite risk score** — Dreyv proprietary 0–100 with explanations

### Pillar F — Agentic Layer (no competitor has this)
26. **Foresight plan** — NL intent → multi-step plan (reuse `/api/foresight/plan`)
27. **Foresight critique** — AI red-team of a proposed plan
28. **Edge insights** — wallet-level alpha signals (reuse `/api/public/edge-insights`)
29. **Narrative generator** — wallet/portfolio prose summary (reuse `/api/public/narrative`)
30. **Watchers** — subscribe to address/token events; webhook + MCP-resource push (reuse `/api/inbox/watchers`)

### Pillar G — Agent Economy (x402 + attestations)
31. **x402 pay** — already shipped, expose as MCP tool `dreyv_x402_pay`
32. **x402 deliverables** — list/get/resend (reuse `/api/agent/deliverables`)
33. **EAS attestations** — `create / verify / revoke` on Base; one per tool call optional
34. **Agent marketplace search** — discover Dreyv-registered agents by capability + price
35. **Capability metering + usage** — per-key usage, billing-grade meter, export

## Technical implementation

### New code
- `src/lib/capabilities/registry.ts` — central declaration (one entry per capability with `{ id, scope, inputSchema, outputSchema, handler, pricing?, sideEffects: 'read' | 'simulate' | 'write' }`)
- `src/lib/capabilities/generate-rest.ts` — builds `/api/v1/[...slug]` route from registry
- `src/lib/capabilities/generate-mcp.ts` — uses `mcp-lite` via Hono to expose `/mcp` (Streamable HTTP). Returns `Accept: application/json, text/event-stream` properly.
- `src/app/api/v1/[...slug]/route.ts` — single dispatcher, validates `dk_live_…`, scope, rate limit, then runs capability
- `src/app/mcp/route.ts` (or Supabase edge function) — MCP transport
- `src/lib/api-keys/` — hash (sha-256), validate, scope-check, rate-limit middleware
- `db-migrations/0032_api_keys_and_usage.sql` — `api_keys` table (id, user_id, hash, prefix, name, scopes[], rate_limit_rpm, last_used_at, revoked_at) + `api_key_usage` (key_id, capability_id, ts, latency_ms, cost_credits, status)
- `src/lib/mev/` — Flashbots Protect + Jito client
- `src/lib/intents/` — ERC-7683 fan-out
- `src/lib/attestations/eas.ts` — EAS wrapper
- `packages/sdk/src/api/` — typed REST + MCP client
- `src/app/developers/api/page.tsx` + `src/app/developers/mcp/page.tsx` — generated docs from registry, with copy-paste Claude/Cursor MCP configs
- `public/openapi.json` — generated from registry

### Reused (no rewrite)
All 50+ existing endpoints from the capability audit (portfolio, treasury, atlas, foresight, x402, deliverables, watchers, narratives, insights, agent system) become capability entries — no logic change, just registry wrapping.

### Auth model summary
| Key | Scope | Used for |
|---|---|---|
| `dk_live_…` / `dk_test_…` | scoped (`read:*`, `write:simulate`, `write:intent`, `agent:delegate`) | REST + MCP general use |
| `dak_…` | payment only | x402 pay endpoints (unchanged) |
| SIWS JWT | user-owned routes | existing app UI |

### Rollout phases
1. **Phase 1 (this PR)** — registry + `dk_live_` real keys + `/api/v1/*` dispatcher + `/mcp` MCP server exposing **pillars A, B, C** (15 tools). Settings UI updated with scopes, last-used, revoke. Developer docs page with Claude/Cursor MCP install snippets.
2. **Phase 2** — pillars D (simulation-first + MEV + intents) + E (forensics).
3. **Phase 3** — pillars F (agentic) + G (attestations + agent marketplace) + metering UI + OpenAPI publish.

### Acceptance for Phase 1
- `dk_live_…` validates server-side; revoking immediately blocks calls.
- `GET /api/v1/portfolio?address=…` works with `Authorization: Bearer dk_live_…`.
- `https://dreyv.com/mcp` returns tool list in Claude Desktop / Cursor; `dreyv_portfolio_get` returns real data.
- `GET /openapi.json` and `/developers/api`, `/developers/mcp` render from registry.
- All 15 Phase-1 tools have integration tests using a sandbox `dk_test_…` key.
- Existing `dak_…` x402 flow untouched.

### Out of scope (deliberately deferred)
- Per-call EAS attestation cost (opt-in flag, default off in Phase 1)
- Full ZK proof generation/verification (Pillar G layer 33 stub only)
- Perps execution on HyperLiquid/Drift (gap acknowledged, future pillar)
- RWA-specific reads (Ondo/BUIDL/Maple) — added in Phase 2 inside Pillar C

This plan turns Dreyv from "another treasury app" into the **single capability surface** every Web3 agent in 2026 plugs into — the Stripe-of-Web3-for-agents thesis from the research.
