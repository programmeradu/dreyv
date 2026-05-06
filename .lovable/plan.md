# Agent-first audit & gap-closing plan

## 1. What "Earn on idle stables" actually does today

| Layer | Status | Notes |
|---|---|---|
| Live APY | ✅ live | `findJupiterEarnMarket()` → Jupiter Earn / Marinade, per route |
| Live idle balance | ✅ live | Helius RPC `getTokenAccountsByOwner` / `getBalance` |
| Arm | ✅ works | flips row to `armed`; watcher drafts deploy on next stable inflow |
| Deploy now | ⚠️ HITL only | enqueues a `yield-deposit` tx proposal; user must sign |
| On-chain execution | ❌ missing | no per-venue ix builder (Marinade/Jupiter Earn deposit ix); proposal carries a generic descriptor |
| CommandBar control | ❌ missing | no NL tools `arm_yield_route`, `deploy_yield_route`, `list_yield_routes` |
| Status correctness | ⚠️ optimistic | flips to `active` on enqueue, not on confirmation |

So: **wired to live data + watcher, but the last mile (build real ix → sign → confirm → mark active) and the agent-control surface are missing.**

## 2. Audit — agent control coverage across the app

Scoring: ✅ NL-controllable + agent context, ⚠️ partial (UI only or context only), ❌ dashboard-only.

### Treasury & Payments
- ✅ `transfer`, `mass_dispatch`, `multisig_proposal`, `create_multisig`
- ✅ `schedule_recurring_payout`, `pause_recurring_payout`, `list_recurring_payouts`
- ✅ `add_invoice`, `list_invoices`, `pay_overdue_invoices`, `invoice_extract`, `invoice_pay`
- ✅ `grant_disbursement`, `grant_milestone_release`, `expense_categorize`
- ⚠️ Gas tank: `configure_gas_tank` exists; `gas_tank_topup` exists — but no `inspect_gas_tank` / auto-refill autopilot

### Yield
- ✅ `stake`, `yield_deposit`, `yield_withdraw`, `rebalance` (with dry-run preview), `execute_dca`
- ⚠️ `draft_yield_route` exists, but **no** `arm_yield_route` / `pause_yield_route` / `deploy_yield_route` / `list_yield_routes` / `delete_yield_route` tools
- ❌ No `auto_compound_yield` / `harvest_rewards`

### Trading
- ✅ `swap`, `execute_swap`, `bridge`, `deploy_sniper_bot`
- ❌ No `limit_order`, `twap`, `cancel_order`, `list_open_orders`

### Risk
- ✅ `counterparty_risk_score`, `stablecoin_diversification`, `tax_lot_tracker`, `hedge_position`, `liquidation_watch`, `mev_rebate_claim`
- ❌ No `arm_liquidation_guard` (auto-deleverage on threshold)

### Policy / Autopilot
- ✅ `set_treasury_policy`, `treasury_runway_autopilot`, `treasury_attestation`
- ⚠️ Policies exist but are **not enforced as a pre-flight gate** on every tool proposal

### Intel / Foresight
- ✅ `foresight_simulation`, `risk_assessment`, `browser_research`, `idl_extraction`, `sentiment_analysis`, `security_firewall`, `protocol_sdk_analyze`
- ⚠️ Analytics page reads/streams data, but the Smart Insights / Foresight panels are not yet exposed as tools (`get_insights`, `get_foresight_narrative`)

### App-shell surfaces NOT yet controllable from CommandBar
- ❌ Vault registry: switch / add / remove / rename active vault from NL
- ❌ Canvas blocks: add / remove / pin a block on the analytics canvas
- ❌ Notifications & alerts: arm an alert ("ping me when SOL drops 10%"), list, mute
- ❌ Subagents: spawn / list / pause / kill from NL (cron triggers exist in DB)
- ❌ Studio / mini-apps: install, run, configure
- ❌ Knowledge memory: save / recall / forget facts the agent should remember
- ❌ Team / invites: invite member, change role, revoke
- ❌ Billing & tier: read tier, list usage, upgrade prompt (read-only at minimum)
- ❌ Theme/network/active-org switching

### Agent context (what the LLM sees per turn) — gaps
- ✅ Yield context (LSTs + APY) is now injected
- ✅ Active vault address is plumbed through
- ❌ Active yield routes (armed / drafts / readyToDeploy) NOT in system prompt
- ❌ Open tx proposals (count, oldest, total USD pending) NOT injected
- ❌ Active policies (caps, allowlists, runway floor) NOT injected
- ❌ Active alerts / watchers NOT injected
- ❌ Recent agent actions ("last 5 things I did") NOT injected → no episodic continuity
- ❌ Subagent status (running cron jobs) NOT injected

## 3. Gap-closing plan — phased

### Phase A — Make the existing yield card fully agentic (1 pass)
1. **Per-venue ix builders**: Marinade `deposit`, Jupiter Earn `deposit`/`withdraw`, native staking `delegate`. Wire into the proposal so the signer flow produces a real on-chain tx.
2. **Confirmation-driven status**: only flip route → `active` after `confirmTransaction` succeeds; on failure → back to `armed` with `lastError`.
3. **New CommandBar tools** (in `capabilities/yield.ts`): `list_yield_routes`, `arm_yield_route`, `pause_yield_route`, `resume_yield_route`, `deploy_yield_route`, `exit_yield_route`, `delete_yield_route`.
4. **Inject into system prompt**: armed-route summary ("2 routes armed: USDC→Marinade 4.2% (1.26 idle, ready), USDS→JupEarn 5.1% (0 idle)").
5. **Card → CommandBar passthrough**: every button on the card also `dispatch()`s the equivalent tool call so the action is logged in the agent timeline.

### Phase B — Cover the rest of the app surface as tools
- Vault registry tools: `switch_vault`, `add_watch_vault`, `remove_vault`, `rename_vault`, `list_vaults`.
- Alerts/notifications: `arm_alert`, `list_alerts`, `mute_alert`, `delete_alert` (+ delivery via existing `notification-delivery`).
- Subagents: `spawn_subagent`, `list_subagents`, `pause_subagent`, `kill_subagent`, `set_subagent_cron`.
- Canvas: `add_canvas_block`, `remove_canvas_block`, `pin_canvas_block`.
- Knowledge memory: `remember_fact`, `recall_facts`, `forget_fact`.
- Team: `invite_member`, `list_members`, `change_role`, `revoke_member`.
- Read-only: `get_tier`, `get_usage`, `get_active_policies`, `get_pending_proposals`.

### Phase C — Universal context injector
Single `buildAgentContext({ wallet, vault })` used by `/api/command`, `/api/analytics/insights`, `/api/foresight/narrative`, watcher reasoning. Returns a compact block:
- Active vault + tier + policies (caps, allowlists, runway floor)
- Holdings summary + yield context (already done)
- **Yield routes summary (new)**
- **Pending proposals summary (new)**
- **Active alerts + subagents (new)**
- **Last 5 agent actions (new)** — episodic memory
- Recent treasury events (last 24h: inflows, outflows, deploys)

### Phase D — Smart auto-deploys (true autonomy, gated by policy)
- **Inflow autopilot**: when stable inflow > policy threshold AND a route is armed AND APY ≥ minApy → draft → if HITL disabled in policy and amount ≤ policyCap → auto-sign via session key → confirm → mark active.
- **Runway autopilot**: extend `treasury_runway_autopilot` to actually call `arm_yield_route` + `deploy_yield_route` when projected runway < floor.
- **Liquidation guard**: arm threshold → on breach, auto-draft `hedge_position` or `yield_withdraw` proposals.
- **Auto-compound**: nightly cron subagent scans yield positions, drafts `harvest_rewards` + `yield_deposit` of harvested amount.
- **Drift rebalancer**: when allocation drifts > policy band, draft `rebalance` proposal automatically.

Every auto-deploy: respects `set_treasury_policy` caps, requires explicit `autopilot.enabled=true` per category, logs to `agent_episodes`, surfaces in CommandBar timeline.

### Phase E — CommandBar as the universal controller
- Replace each card's button onClick with `dispatch({ tool_id, parameters })` → agent runs the tool → UI updates from the same event stream the agent emits. (Single source of truth: agent action log → UI state.)
- Every page mounts a `<CommandContextProvider scope="…">` that registers what's on screen so the agent knows the user's focus ("user is on /app/treasury looking at route X" goes into context).

## 4. Suggested execution order
1. **Phase A** (close the loop on the card the user just asked about) — 1 pass.
2. **Phase C** (context injector) — unlocks every later phase being smarter from turn 1.
3. **Phase B** (tool coverage) — incrementally, prioritized: vault switch, alerts, subagents, knowledge.
4. **Phase D** (autopilots) — one autopilot per pass (inflow → runway → liquidation → compound → drift).
5. **Phase E** (UI ↔ agent unification) — last, because it depends on tool coverage being broad enough.

## 5. Open decisions for you
- **Session-key signing for auto-deploy**: do we want a Squads "agent member" with a tight policy cap, or keep everything HITL until the user explicitly opts in per-category?
- **First autopilot to ship**: inflow → yield (closes the current card's loop), runway autopilot, or liquidation guard?
- **Tool coverage priority**: vault/alerts/subagents/knowledge — which two first?

Pick the answers and I'll start with Phase A + the chosen autopilot in the next pass.
