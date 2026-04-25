# DACS — Dreyv Agentic Command System Migration Plan

Working contract for migrating the CommandBar from a single 2,500-line streamText+tools route into a bus-driven, durable, multi-stage agent pipeline.

## Locked decisions
| Topic | Decision |
|---|---|
| LLM provider order in `/api/command` | **Groq → Cloudflare → Lovable** (last-resort) |
| Plan approval | Phase by phase, in order 0→6 |
| Dynamic scope | Full dynamic with HITL queue + risk-agent gating |
| HITL policy | Per-user policy table; default = require approval |
| Rollout | Shadow mode 1 week → diff harness → hard cutover |

## Phase 0 — Capability registry extraction (no behavior change)
Extract all 30 inline tools from `src/app/api/command/route.ts` into `src/lib/agents/capabilities/<name>.ts`, each exporting:
```ts
{ id, description, inputSchema, outputSchema, sideEffects: 'read'|'write'|'sim',
  requiredAuth: 'none'|'wallet'|'multisig', sensitivity: 'low'|'medium'|'high', executor }
```
Build `capabilityRegistry`, add coverage test asserting every legacy tool maps to a registry entry. **Zero regressions allowed.**

## Phase 1 — Bus-based pipeline (parity, behind `DACS_ENABLED` flag)
- New event `agent.command.submitted`
- New Inngest fn `commandRouter`:
  1. Intent extraction (Groq llama-3.3) → typed `Intent { kind, entities, constraints, confidence, ambiguities[] }`
  2. Plan synthesis (Gemini deep when complex, Groq when simple) → typed `Plan { steps: CapabilityCall[], rationale, reversibility, risk_score }`
  3. Reflect (`reflector.critiquePlan(plan)`) — challenges plan, can revise/kill steps
  4. Route: read → exec; write below threshold → exec; write above OR multisig → `agent_tx_proposals`
- SSE proxy: `/api/command` (new code path) holds an SSE channel and forwards bus events (`step.started`, `step.token`, `step.tool_result`, `plan.ready`, `awaiting_approval`, `done`)
- Streaming UX preserved or improved.

## Phase 2 — Open-vocabulary planner (full dynamic + HITL)
Three layers in planner order:
1. **Capability registry** (deterministic, fast)
2. **Composition** — chain primitives into novel macros, cached by intent signature
3. **Dynamic capabilities** — emit `DynamicCapabilitySpec`, run in `sandbox-runner` with allowlist:
   - Read tier: Helius RPC, Jupiter quotes, DefiLlama, Birdeye, KB, web search
   - Write tier: must pass risk-agent + always queue to HITL

## Phase 3 — Episodic memory + per-user policy
- `agent_episodes` table: every command, plan, decision, outcome (with embedding)
- Nightly job derives `user_agent_policy` rules from episodes ("rejects swaps >2% impact", "prefers Marinade", "confirm above $500")
- Plan-time injection of policy as constraints; reflector vetoes violations
- `tx-reconciler` failure → `reflector.postMortem` → write to `knowledge-memory`

## Phase 4 — Sub-agent runtime (background continuation)
Wire CommandBar to spawn `SubAgentSpec` for "watch / DCA / alert" intents:
- Per-spec Inngest fn with TTL + kill switch
- Each tick runs scoped `triage → deep → executor-bridge` mini-pipeline
- Surface in `/inbox` and `/agents` with status, last fire, P&L attribution

## Phase 5 — Multi-agent orchestration
- Specialist agents: `treasury-agent` (exists), `research-agent`, `market-agent`, `builder-agent`, `risk-agent`
- `commandRouter` becomes dispatcher via `agent.handoff`
- Specialists return `AgentReport` to orchestrator
- Cross-Agent Treasury Protocol envelope (first-mover concept)

## Phase 6 — Cutover + legacy deletion
- After 1 week shadow + green diff metrics, flip `DACS_ENABLED=true` for all
- Reduce `route.ts` to ~200-line SSE proxy
- Delete inline tool definitions

## Capability inventory (must all migrate, none lost)
**Treasury & wallets:** create_multisig, transfer, rebalance, mass_dispatch, multisig_proposal
**Trading:** swap, swap_v2 (Jupiter), bridge, deploy_sniper_bot
**Yield:** stake, yield_deposit, yield_withdraw, dca
**Intel & sim:** what_if, risk_assessment, sentiment_analysis, browser_research, idl_extraction, sdk_protocol_analyze, security_firewall (pre-flight sim)
**Studio:** init_miniapp, analyze_code, marketplace_publish, sdk_hooks_inject, studio_lookup_by_appid, studio_lookup_by_name, studio_list_recent, studio_resolve_link
**Dynamic:** dynamic_tool_draft, dynamic_tool_compose, dynamic_tool_sandbox_exec
**Misc:** set_monitor, verify_external_payload, navigate, knowledge lookups

## New capabilities unlocked
- Composition macros (cached by intent signature)
- Dynamic read-only research/answer plans (sandboxed)
- Dynamic write paths (sandbox → risk-agent → HITL)
- Background sub-agents from natural-language intent
- Cross-agent collaboration via specialist handoff

## File map
**Existing (referenced):**
- Bus: `src/lib/agents/bus.ts`, `inngest-client.ts`
- Brains: `src/lib/agents/brains/{groq-triage,gemini-deep,reflector,executor-plans,executor-bridge,storage,tx-reconciler,watchers,functions}.ts`
- Coordinator: `src/lib/agents/coordinator.ts`
- Sandbox: `src/lib/dynamic-tools/sandbox-runner.ts`
- Memory: `src/lib/knowledge-memory.ts`
- Tables: `agent_proposals`, `agent_tx_proposals`, `agent_subagents`, `agent_treasury_watchers`

**To add:**
- `src/lib/agents/capabilities/*.ts` (one per capability, ~30 files)
- `src/lib/agents/capabilities/registry.ts`
- `src/lib/agents/dacs/{intent,plan,route,sse-proxy}.ts`
- Schema: `user_agent_policy`, `agent_episodes`, `command_diff_log`
- `src/app/api/admin/dacs-diff/route.ts`

## Cross-cutting requirements
- Every write defaults to HITL queue. Auto-approve only when user policy explicitly opts in (threshold + protocol allowlist).
- Shadow-mode diff harness must log both pipelines per request and surface divergences in admin view.
- Risk-agent must veto any dynamic plan touching protocols not in user policy allowlist OR exceeding user-defined value cap.
