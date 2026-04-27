-- DACS Phase 4.1 — Cron expressions + conditional triggers + canvas spawn provenance.
--
-- Adds three orthogonal capabilities to existing dacs_subagents rows without
-- changing how legacy interval-based subagents work:
--
--   cron_expr     — optional cron string (5 or 6 field). When set, the
--                   ticker computes next_run_at from this instead of
--                   incrementing by interval_seconds. Falls back to
--                   interval when null/unparseable.
--
--   trigger       — jsonb conditional spec evaluated at each tick. When
--                   present and the condition does NOT hold, the tick is
--                   "skipped" (subagent stays active, next_run_at advances,
--                   no child command is submitted). Schema:
--                     { kind: "price"|"wallet"|"news"|"handoff",
--                       op:   "lt"|"gt"|"lte"|"gte"|"eq"|"contains"|"any",
--                       ...kind-specific fields }
--
--   trigger_meta  — last evaluator output (for the UI to show why a tick
--                   fired or was skipped). { firedAt, skippedAt, lastValue,
--                   lastReason }.
--
--   spawned_from  — provenance for canvas-CTA spawned subagents:
--                     { kind: "canvas_block", blockId, blockType, title }
--                   Lets the UI link back to the originating finding.
--
-- All columns nullable / default — fully backward compatible with rows
-- inserted by the Phase 4 router.

ALTER TABLE dacs_subagents
  ADD COLUMN IF NOT EXISTS cron_expr      text,
  ADD COLUMN IF NOT EXISTS trigger        jsonb,
  ADD COLUMN IF NOT EXISTS trigger_meta   jsonb,
  ADD COLUMN IF NOT EXISTS spawned_from   jsonb,
  ADD COLUMN IF NOT EXISTS last_eval_at   timestamp;

CREATE INDEX IF NOT EXISTS dacs_subagents_cron_idx       ON dacs_subagents(cron_expr) WHERE cron_expr IS NOT NULL;
CREATE INDEX IF NOT EXISTS dacs_subagents_trigger_kind_idx ON dacs_subagents((trigger->>'kind')) WHERE trigger IS NOT NULL;
