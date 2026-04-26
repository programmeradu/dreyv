---
name: dacs
description: DACS migration (CommandBar → bus-driven agent pipeline). 6 phases, 48 capabilities, HITL queue + per-user policy + episodic memory + post-mortem + policy-derivation cron + sub-agent runtime + specialist handoffs. Phase 0/1/2/3/4/5 done.
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
- Phase 4 sub-agents: each tick re-submits original raw_text as fresh `agent.command.submitted`, so policy/HITL/episodes/post-mortem all apply to ticks too. Expired/maxed auto-completed at dispatch.
- Phase 5 specialists (CATP v1.0): one Inngest fn per specialist on `agent.handoff.requested`, runs only owned domain + safe (read/sim/meta) steps, defers writes to HITL executor, persists `AgentReport` to `dacs_handoffs` and emits `agent.handoff.reported`. Single-specialist-per-command for now (multi-specialist fanout is forward-compatible in schema).

**Status:**
- Phase 0 (capability registry, 48 caps): DONE
- Phase 1 (DACS pipeline shadow mode, diff log, SSE proxy, parity audit): DONE
- Phase 2 (HITL queue + open-vocab compose veto + per-user policy): DONE
- Phase 3 (episodic memory + executor + post-mortem + policy-derivation cron + PolicySuggestionsPanel): DONE
- Phase 4 (sub-agent runtime + auto-complete expired/maxed + `agent.subagent.ticked` event + SubagentsPanel): DONE
- Phase 5 (specialist runtime + `agent.handoff.reported` + HandoffsPanel + `/app/admin/dacs-handoffs` audit): DONE
- Phase 6 NEXT: cutover — flip `DACS_ENABLED=primary`, reduce `/api/command/route.ts` to ~200-line SSE proxy, delete inline 2,500-line tool definitions.

Migrations: `0010_command_diff_log.sql`, `0011_dacs_phase2_hitl.sql`, `0012_dacs_phase3_episodes.sql`, `0013_dacs_phase4_subagents.sql`, `0014_dacs_phase5_handoffs.sql`, `0015_dacs_phase3_policy_suggestions.sql`.
Bus events: `agent.command.submitted/intent.classified/plan.synthesized/plan.routed/command.completed/approval.requested/approval.resolved/handoff.requested/handoff.reported/subagent.tick/subagent.ticked`.
Admin pages: `/app/admin/dacs-diff` (row stream), `/app/admin/dacs-parity-audit` (per-route drift), `/app/admin/dacs-handoffs` (per-specialist health).
Flag: `DACS_ENABLED` (off | shadow | primary).
