/**
 * DACS Phase 1+ — public function registry.
 * Imported by `src/app/api/inngest/route.ts` so Inngest discovers them.
 */

import { commandRouter } from "./command-router";
import { executeApprovedPlan } from "./executor";
import { subagentTickerCron, subagentTick } from "./subagent-runtime";
import { SPECIALIST_FUNCTIONS } from "./specialist-runtime";
import { dacsPolicyDerivation } from "./policy-derivation";
import { reconcileStreamflowStreams } from "./reconcile-streamflow";
import { gasTankWatcher } from "./gas-tank-watcher";
import { grantsWatcher } from "./grants-watcher";
import { liquidationWatcher } from "./liq-watcher";
import { runwayAutopilotWatcher } from "./runway-watcher";
import { monthlyBurnStatementCron } from "./burn-statement-cron";

export const DACS_FUNCTIONS = [
  commandRouter,
  executeApprovedPlan,
  subagentTickerCron,
  subagentTick,
  dacsPolicyDerivation,
  reconcileStreamflowStreams,
  gasTankWatcher,
  grantsWatcher,
  liquidationWatcher,
  runwayAutopilotWatcher,
  monthlyBurnStatementCron,
  ...SPECIALIST_FUNCTIONS,
];

