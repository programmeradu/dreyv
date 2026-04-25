/**
 * DACS Phase 1+ — public function registry.
 * Imported by `src/app/api/inngest/route.ts` so Inngest discovers them.
 */

import { commandRouter } from "./command-router";
import { executeApprovedPlan } from "./executor";
import { subagentTickerCron, subagentTick } from "./subagent-runtime";
import { SPECIALIST_FUNCTIONS } from "./specialist-runtime";

export const DACS_FUNCTIONS = [
  commandRouter,
  executeApprovedPlan,
  subagentTickerCron,
  subagentTick,
  ...SPECIALIST_FUNCTIONS,
];

