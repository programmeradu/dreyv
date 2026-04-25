/**
 * DACS Phase 1 — commandRouter Inngest function.
 *
 * Subscribes to `agent.command.submitted`, runs the full DACS pipeline:
 *   1. classifyIntent  → publish "agent.intent.classified" + diff-log
 *   2. synthesizePlan  → publish "agent.plan.synthesized" + diff-log
 *   3. routePlan       → publish "agent.plan.routed" + diff-log
 *   4. (Phase 2 will execute / queue HITL here)
 *   5. publish "agent.command.completed" + parity verdict
 *
 * Phase 1 stops at step 3: emitting the routed decision to the bus and
 * persisting the DACS snapshot so the SSE proxy + shadow-mode diff harness
 * can consume it. Real execution still served by legacy `route.ts`.
 */

import { inngest } from "../inngest-client";
import { publish } from "../bus";
import { classifyIntent } from "./intent";
import { synthesizePlan } from "./plan";
import { routePlan } from "./route";
import { recordDacs, computeParity } from "./diff-log";
import type { CommandSubmittedPayload } from "./types";

export const commandRouter = inngest.createFunction(
  {
    id: "dacs-command-router",
    name: "DACS · Command Router",
    concurrency: { limit: 50 },
    retries: 2,
  },
  { event: "agent.command.submitted" },
  async ({ event, step }) => {
    const payload = event.data as CommandSubmittedPayload;
    const { commandId, walletAddress, rawText, promptMode } = payload;
    const startedAt = Date.now();

    const intent = await step.run("classify-intent", async () => {
      const i = await classifyIntent(rawText);
      await publish({
        name: "agent.intent.classified",
        data: { commandId, walletAddress, intent: i },
      });
      return i;
    });

    const plan = await step.run("synthesize-plan", async () => {
      const p = await synthesizePlan(intent);
      await publish({
        name: "agent.plan.synthesized",
        data: { commandId, walletAddress, plan: p },
      });
      return p;
    });

    const decision = await step.run("route-plan", async () => {
      const d = routePlan(intent, plan, { promptMode });
      await publish({
        name: "agent.plan.routed",
        data: { commandId, walletAddress, decision: d },
      });
      return d;
    });

    await step.run("persist-diff-snapshot", async () => {
      await recordDacs({
        commandId,
        intent,
        plan,
        decision,
        latencyMs: Date.now() - startedAt,
      });
      await computeParity(commandId);
    });

    await publish({
      name: "agent.command.completed",
      data: { commandId, walletAddress, decisionKind: decision.kind, completedAt: Date.now() },
    });

    return { commandId, intentKind: intent.kind, decisionKind: decision.kind, steps: plan.steps.length };
  },
);
