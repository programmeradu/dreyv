---
name: dacs
description: DACS migration (CommandBar → bus-driven agent pipeline). 6 phases, 48 capabilities, HITL queue + per-user policy + episodic memory + post-mortem + policy-derivation cron + sub-agent runtime. Phase 0/1/2/3/4 done.
type: feature
---
DACS = Dreyv Agentic Command System. Replaces 2,500-line `/api/command` streamText+tools route with bus-driven multi-stage pipeline.

**Locked decisions:**
- LLM order: Groq → Cloudflare → Lovable
- Phase 0→6 in order
- Full dynamic with HITL + risk-agent gating
- Per-user policy default = require approval
- Shadow → diff harness → cutover
- Phase 3 policy derivation: **auto-apply low-risk** (allowlist additions only, ≥3 successes, 0 rejections, value ≤ daily cap); everything else proposed via `pending_suggestions`
- Phase 4 sub-agents: each tick re-submits original raw_text as a fresh `agent.command.submitted`, so policy/HITL/episodes/post-mortem all apply to ticks too. Expired/maxed rows auto-completed at dispatch.

**Status:**
- Phase 0 (capability registry, 48 caps incl. 14 net-new in policy/payments/risk): DONE
- Phase 1 (DACS pipeline shadow mode, diff log, SSE proxy, admin parity audit): DONE
- Phase 2 (HITL queue + open-vocab compose veto + per-user policy): DONE
- Phase 3 (episodic memory + executor + post-mortem + policy-derivation cron + /app/settings UI w/ PolicySuggestionsPanel): DONE
- Phase 4 (sub-agent runtime: store + cron sweep + tick handler + /api/dacs/subagents + SubagentsPanel + auto-complete expired/maxed at dispatch + `agent.subagent.ticked` event for inbox visibility): DONE
- Phase 5 NEXT: multi-agent orchestration (specialists already scaffolded — `specialists.ts`, `specialist-runtime.ts`, `/api/dacs/handoffs` — needs full handoff envelope wiring + AgentReport persistence + UI)
- Phase 6: cutover + delete legacy `/api/command`

Migrations: `0010_command_diff_log.sql`, `0011_dacs_phase2_hitl.sql`, `0012_dacs_phase3_episodes.sql`, `0013_dacs_phase4_subagents.sql`, `0014_dacs_phase5_handoffs.sql`, `0015_dacs_phase3_policy_suggestions.sql`.
Bus events: `agent.command.submitted/intent.classified/plan.synthesized/plan.routed/command.completed/approval.requested/approval.resolved/handoff.requested/handoff.reported/subagent.tick/subagent.ticked`.
Flag: `DACS_ENABLED` (off | shadow | primary).
