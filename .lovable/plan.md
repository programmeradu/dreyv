# Launch Sprint — Agentic Control Plane

This is a big sprint. I'll execute it in the order you gave, then close with the cross-cutting items (observability, onboarding, billing gating, docs). Each phase ships end-to-end (schema → server → agent tool → UI) before moving on, so nothing is left half-wired.

## Sequencing

```text
3 Signing + caps  →  4 Policy guard  →  2 Autopilot live  →  6 Proposal inbox
   →  7 Realtime push  →  1 Page focus  →  8 Safety rails
   →  Observability  →  Onboarding  →  Billing gating  →  Docs / partner kit
```

## Phase 3 — Session keys + agent member (caps-bound signing)
- New table `agent_signers` (vault_id, kind=`session_key|squads_member`, pubkey, policy_caps jsonb, status, expires_at, kill_switch_at).
- Capabilities: `provision_agent_signer`, `revoke_agent_signer`, `list_agent_signers`, `set_kill_switch`.
- Squads path: add agent member with threshold-aware proposal flow (still HITL until caps satisfied); session-key path for non-multisig vaults via short-TTL keypair envelope (reuse `keypair-envelope.ts`).
- All caps stored as `{maxUsdPerTx, maxUsdPerDay, allowedProtocols[], allowedActions[], expiresAt}`.

## Phase 4 — Policy guard (real enforcement)
- New `lib/agents/policy/guard.ts` `evaluate(plan, signer, episodicSpend)` → `{allow|queue|deny, reasons[]}`.
- Wire into `dacs/route.ts` BEFORE the existing risk gate; deny → reject, queue → HITL, allow → execute.
- Daily spend rolled up from `episodes` table; cached per vault.
- Kill switch flips signer.status to `revoked` and forces `queue` for everything.

## Phase 2 — First autopilot live (inflow → yield)
- Inngest cron `autopilot/inflow-yield` every 5 min:
  1. Pull idle stables per registered vault (Helius).
  2. If `idle_usdc > policy.minIdleUsd`, plan `yield_deposit` to top route from `yield-routes`.
  3. Run through DACS router → policy guard → execute or queue.
- Idempotency key `${vault}:${slot_bucket}:inflow-yield`.
- Every step writes to `episodes` (capability_id, input_hash, outcome, latency_ms, cost_usd_est).

## Phase 6 — Proposal inbox
- `/app/inbox` page + `InboxBadge` in shell.
- Lists `agent_proposals` with diff view, risk, policy reason, approve/reject/snooze.
- Approve → calls `/api/agentic/approve` PATCH with wallet signature.
- New capability `list_proposals_v2`, `decide_proposal` (agent can ask "approve all low-risk USDC swaps under $500" and we resolve to ids).

## Phase 7 — Realtime push to CommandBar
- Postgres `LISTEN/NOTIFY` channel `agent_events` (or Supabase realtime on `episodes` + `agent_proposals`).
- New SSE route `/api/command/stream` emitting `event: agent_push` with payload.
- CommandBar subscribes via `EventSource`, injects pushes as system messages so the agent reasons over them on the next turn (and surfaces them as toast).

## Phase 1 — Focus on all pages
- Add `useDeclareFocus(...)` to: Treasury, Analytics, Yield Routes, Vault detail, Inbox, Studio project, Atlas token detail, Settings.
- Each declares `{scope, label, data}` with the minimum stable payload (ids, not full rows).

## Phase 8 — Safety rails
- Simulation firewall: every write capability runs `simulateTransaction` first; drop if balance delta sign-flips outside expected.
- Slippage cap default 50 bps, override per-policy.
- Circuit breaker: 3 consecutive tool errors OR 1 firewall reject in 10 min → freeze autopilot, raise inbox proposal "resume?".
- Allowlist enforced in policy guard (already wired in Phase 4).

## Cross-cutting (smaller, ship after rails)
- **Observability**: middleware around capability execute → records `latency_ms`, `error_code`, `tokens_in/out`, `cost_usd_est`. New `/app/admin/traces` (founder-only) reading `episodes`.
- **Onboarding**: `/app/onboarding` 4-step (connect vault → choose risk profile → arm 1 route → set 1 alert). Skippable but default policies + 1 watcher seeded so the agent has something to reason over from message #1.
- **Billing gating**: capability registry annotated with `minTier`; pre-execution check rejects with upgrade CTA. Agent runs/day, vaults, miniapps already in `tier-config.ts` — extend to capabilities.
- **Docs + partner kit**: `/developers` adds Agent Capabilities reference (auto-generated from registry), Policy schema, Webhook events. New `docs/design-partner-kit.md` with onboarding script, success criteria, support SLAs.

## Technical notes
- All new tables get RLS scoped by `user_id` via existing `vaults` join helper.
- All new agent capabilities registered in `capabilities/registry.ts` and added to `system-prompt.ts` vocabulary.
- Episode writes go through one helper `recordEpisode()` so observability is automatic.
- No new providers — Lovable AI only, via the existing edge function path.

## Order of merges (so preview never breaks)
1. Migrations (signers, policy caps, episodes columns, proposals v2 cols).
2. Server libs (policy guard, episode recorder, autopilot job).
3. Agent capabilities + registry + prompt.
4. UI (inbox, focus hooks, onboarding, admin traces).
5. Realtime SSE + CommandBar subscription.
6. Safety rails toggle on by default.
7. Docs + partner kit.

Approve and I'll start with Phase 3 migrations.