---
name: dacs
description: DACS migration (CommandBar → bus-driven agent pipeline). 6 phases, 48 capabilities, HITL queue + per-user policy. Phase 0/1/2 done.
type: feature
---
DACS = Dreyv Agentic Command System. Replaces 2,500-line `/api/command` streamText+tools route with bus-driven multi-stage pipeline.

**Locked decisions:**
- LLM order: Groq → Cloudflare → Lovable
- Phase 0→6 in order
- Full dynamic with HITL + risk-agent gating
- Per-user policy default = require approval
- Shadow → diff harness → cutover

**Status:**
- Phase 0 (capability registry, 48 caps): DONE — `src/lib/agents/capabilities/`
- Phase 1 (DACS pipeline, shadow mode, diff log, SSE proxy, admin view): DONE — `src/lib/agents/dacs/{intent,plan,route,command-router,diff-log}.ts`
- Phase 2 (HITL queue + open-vocab compose veto + per-user policy): DONE — `src/lib/agents/dacs/{hitl-queue,policy-store,compose}.ts` + `command_approvals` / `user_agent_policy` tables + `/api/dacs/{approvals,policy}`
- Phase 3 NEXT: episodic memory + executor for approved plans + `/app/settings` policy UI
- Phases 4–6: sub-agent runtime, multi-agent orchestration, cutover + legacy deletion

Migrations: `scripts/migrations/0010_command_diff_log.sql`, `0011_dacs_phase2_hitl.sql`.
Bus events (DACS): `agent.command.submitted/intent.classified/plan.synthesized/plan.routed/command.completed/approval.requested/approval.resolved`.
Flag: `DACS_ENABLED` (off | shadow | primary).
