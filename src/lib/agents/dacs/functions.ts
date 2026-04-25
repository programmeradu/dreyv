/**
 * DACS Phase 1+ — public function registry.
 * Imported by `src/app/api/inngest/route.ts` so Inngest discovers them.
 */

import { commandRouter } from "./command-router";
import { executeApprovedPlan } from "./executor";

export const DACS_FUNCTIONS = [commandRouter, executeApprovedPlan];
