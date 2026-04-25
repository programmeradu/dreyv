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
import { verifyComposedPlan } from "./compose";
import { loadUserPolicy } from "./policy-store";
import { enqueueApproval } from "./hitl-queue";
import { recallEpisodes, recordEpisode } from "./episodes";
import { spawnSubagent } from "./subagent-store";
import { buildEnvelope, runSpecialistStub } from "./specialists";
import type { CommandSubmittedPayload, Intent, Plan, RouteDecision } from "./types";

/**
 * Detect a recurring/monitoring shape: intent.kind=monitor, or constraints
 * carry an explicit cadence (frequency / iterations / recurrence).
 * Returns the inferred interval in seconds (default 24h) when matched.
 */
function detectRecurringSpec(intent: Intent): { recurring: boolean; intervalSeconds: number; maxTicks: number | null } {
  const c = intent.constraints ?? {};
  const freq = String(c.frequency ?? c.cadence ?? "").toLowerCase();
  const iterations = Number(c.iterations ?? c.cycles ?? 0) || null;
  const isMonitor = intent.kind === "monitor";
  const hasRecurrence = !!(c.recurrence || c.frequency || c.cadence || c.iterations);
  if (!isMonitor && !hasRecurrence) return { recurring: false, intervalSeconds: 86400, maxTicks: null };
  let interval = 86_400;
  if (freq.includes("hour")) interval = 3600;
  else if (freq.includes("minute")) interval = 600;
  else if (freq.includes("week")) interval = 7 * 86_400;
  else if (freq.includes("day") || isMonitor) interval = 86_400;
  return { recurring: true, intervalSeconds: interval, maxTicks: iterations };
}

export const commandRouter = inngest.createFunction(
  {
    id: "dacs-command-router",
    name: "DACS · Command Router",
    concurrency: { limit: 5 },
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

    const rawPlan = await step.run("synthesize-plan", async () => {
      const p = await synthesizePlan(intent);
      await publish({
        name: "agent.plan.synthesized",
        data: { commandId, walletAddress, plan: p },
      });
      return p;
    });

    // Phase 2: load per-user policy + run open-vocab plan through compose veto.
    // Phase 3: pull episodic memory and bias risk_score before routing.
    const [policy, recall] = await Promise.all([
      step.run("load-policy", async () => loadUserPolicy(walletAddress)),
      step.run("recall-episodes", async () => recallEpisodes(walletAddress, intent.kind)),
    ]);

    // Episodic bias: if the user historically rejects this intent kind,
    // bump risk_score so the next plan needs HITL even if value is low.
    let biasedPlan: Plan = rawPlan;
    if (recall.approvalRate != null && recall.total >= 3) {
      const rejectionPressure = 1 - recall.approvalRate;
      const bias = Math.min(0.25, rejectionPressure * 0.3);
      const newRisk = Math.min(1, (rawPlan.riskScore ?? 0) + bias);
      biasedPlan = {
        ...rawPlan,
        riskScore: newRisk,
        rationale:
          bias > 0.05
            ? `${rawPlan.rationale} (Risk +${bias.toFixed(2)} from past ${recall.total} ${intent.kind} episodes; approval rate ${(recall.approvalRate * 100).toFixed(0)}%.)`
            : rawPlan.rationale,
      };
    }

    const verdict = verifyComposedPlan(biasedPlan, { policy, promptMode });
    const plan = verdict.plan;

    if (!verdict.ok && verdict.rejection) {
      await publish({
        name: "agent.plan.routed",
        data: { commandId, walletAddress, decision: verdict.rejection },
      });
      await step.run("persist-rejection", async () => {
        await recordDacs({
          commandId,
          intent,
          plan,
          decision: verdict.rejection!,
          latencyMs: Date.now() - startedAt,
        });
        await computeParity(commandId);
      });
      await publish({
        name: "agent.command.completed",
        data: {
          commandId,
          walletAddress,
          decisionKind: verdict.rejection.kind,
          completedAt: Date.now(),
        },
      });
      return { commandId, intentKind: intent.kind, decisionKind: verdict.rejection.kind, steps: 0 };
    }

    // Phase 4: recurring/monitoring intents are deferred to a sub-agent
    // instead of executing immediately. Skip when this command is itself a
    // sub-agent tick (commandId starts with `sa_`).
    const recurring = detectRecurringSpec(intent);
    const isSubagentTick = commandId.startsWith("sa_");
    if (recurring.recurring && !isSubagentTick && plan.steps.length > 0) {
      const subagentId = await step.run("spawn-subagent", async () =>
        spawnSubagent({
          walletAddress,
          parentCommandId: commandId,
          title: rawText.slice(0, 80),
          rawText,
          intent,
          planTemplate: plan,
          intervalSeconds: recurring.intervalSeconds,
          maxTicks: recurring.maxTicks,
        }),
      );
      const deferDecision: RouteDecision = {
        kind: "defer_to_subagent",
        plan,
        reason: `Spawned sub-agent (interval ${recurring.intervalSeconds}s${recurring.maxTicks ? `, max ${recurring.maxTicks} ticks` : ""}).`,
        approvalQueueId: subagentId ?? undefined,
      };
      await publish({
        name: "agent.plan.routed",
        data: { commandId, walletAddress, decision: deferDecision },
      });
      if (subagentId) {
        await publish({
          name: "agent.subagent.spawned",
          data: { subagentId, commandId, walletAddress, intervalSeconds: recurring.intervalSeconds },
        });
      }
      await step.run("persist-defer-snapshot", async () => {
        await recordDacs({
          commandId,
          intent,
          plan,
          decision: deferDecision,
          latencyMs: Date.now() - startedAt,
        });
        await computeParity(commandId);
      });
      await publish({
        name: "agent.command.completed",
        data: { commandId, walletAddress, decisionKind: deferDecision.kind, completedAt: Date.now() },
      });
      return { commandId, intentKind: intent.kind, decisionKind: deferDecision.kind, steps: plan.steps.length, subagentId };
    }

    const decision = await step.run("route-plan", async () => {
      const d = routePlan(intent, plan, { policy, promptMode });
      // Phase 2: when the router queues a plan, persist it to the HITL queue
      // and enrich the decision with the resulting approvalQueueId.
      if (d.kind === "queue_for_approval") {
        const approvalId = await enqueueApproval({
          commandId,
          walletAddress,
          intent,
          plan,
          decision: d,
          ttlHours: plan.riskScore >= 0.7 ? 6 : 24,
        });
        if (approvalId) {
          d.approvalQueueId = approvalId;
          await publish({
            name: "agent.approval.requested",
            data: { commandId, walletAddress, approvalId, reason: d.reason },
          });
        }
      }
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

    // Phase 3: record episode for terminal decisions (auto_execute / reject).
    // queue_for_approval episodes are recorded by the executor on resolution.
    if (decision.kind === "auto_execute" || decision.kind === "reject") {
      await step.run("record-episode", async () => {
        await recordEpisode({
          commandId,
          walletAddress,
          intent,
          plan,
          outcome: decision.kind === "auto_execute" ? "auto_executed" : "rejected",
          durationMs: Date.now() - startedAt,
          notes: decision.reason,
        });
      });
    }

    await publish({
      name: "agent.command.completed",
      data: { commandId, walletAddress, decisionKind: decision.kind, completedAt: Date.now() },
    });

    return { commandId, intentKind: intent.kind, decisionKind: decision.kind, steps: plan.steps.length };
  },
);
