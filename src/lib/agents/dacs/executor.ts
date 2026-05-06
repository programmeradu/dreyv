/**
 * DACS Phase 3 — Executor for approved plans.
 *
 * Triggered by `agent.approval.resolved` when status === 'approved'. Loads
 * the queued plan, runs each capability sequentially through the registry,
 * records the outcome to episodic memory, and marks the approval row as
 * 'executed' (or 'approved_failed' on error).
 *
 * Write-side capabilities normally produce serialized transactions for the
 * client to sign — in that case we treat "queued for signing" as a
 * successful execution from the executor's perspective. Read/sim/meta steps
 * run in-process.
 */
import { inngest } from "../inngest-client";
import { publish } from "../bus";
import { db } from "@/db";
import { commandApprovals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { capabilityRegistry } from "../capabilities/registry";
import type { CapabilityContext, ExecutionState } from "../capabilities/types";
import { recordEpisode } from "./episodes";
import { recordPostMortem } from "./post-mortem";
import { recordToolMetric, noteToolOutcome, tripCircuitBreaker } from "../policy/guard";
import { resolveUserIdFromWallet } from "../brains/storage";
import type { Intent, Plan, RouteDecision } from "./types";

function buildHeadlessContext(walletAddress: string | null): CapabilityContext {
  const executionState: ExecutionState = {};
  return {
    walletAddress,
    rpcEndpoint: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    vaultState: null,
    walletState: null,
    executionState,
    promptMode: "execute",
    isStudioBuildIntent: false,
    blockExecutionForBuildIntent: () => null,
    resolveSplitAmount: (_token: string, requestedAmount: number) => ({
      amount: requestedAmount,
      adjusted: false,
      reason: undefined,
    }),
  };
}

export const executeApprovedPlan = inngest.createFunction(
  {
    id: "dacs-execute-approved-plan",
    name: "DACS · Execute Approved Plan",
    concurrency: { limit: 5 },
    retries: 1,
  },
  { event: "agent.approval.resolved" },
  async ({ event, step }) => {
    const { approvalId, status } = event.data as {
      approvalId: string;
      status: "approved" | "rejected" | "expired";
      commandId?: string;
      walletAddress?: string | null;
    };
    if (status !== "approved") {
      // Record a non-success episode for rejected/expired so the planner
      // learns from it on the next similar request.
      if (db && (status === "rejected" || status === "expired")) {
        await step.run("record-non-success-episode", async () => {
          const [row] = await db!
            .select()
            .from(commandApprovals)
            .where(eq(commandApprovals.id, approvalId))
            .limit(1);
          if (!row) return;
          await recordEpisode({
            commandId: row.commandId,
            walletAddress: row.walletAddress,
            intent: row.intent as unknown as Intent,
            plan: row.plan as unknown as Plan,
            outcome: status === "rejected" ? "rejected" : "expired",
            notes: row.resolutionNote ?? undefined,
          });
        });
      }
      return { approvalId, skipped: true, status };
    }

    const startedAt = Date.now();

    const row = await step.run("load-approval", async () => {
      if (!db) throw new Error("DB not initialized");
      const [r] = await db
        .select()
        .from(commandApprovals)
        .where(eq(commandApprovals.id, approvalId))
        .limit(1);
      if (!r) throw new Error(`approval ${approvalId} not found`);
      if (r.status !== "approved") {
        throw new Error(`approval ${approvalId} not in approved state (was ${r.status})`);
      }
      return r;
    });

    const intent = row.intent as unknown as Intent;
    const plan = row.plan as unknown as Plan;
    const decision = row.decision as unknown as RouteDecision;

    const ctx = buildHeadlessContext(row.walletAddress);
    const registry = capabilityRegistry();
    const stepResults: Array<{
      capabilityId: string;
      ok: boolean;
      output?: unknown;
      error?: string;
    }> = [];

    let firstError: string | null = null;
    let signature: string | null = null;

    for (let i = 0; i < plan.steps.length; i++) {
      const planStep = plan.steps[i];
      const cap = registry.get(planStep.capabilityId);
      if (!cap) {
        firstError = `Unknown capability: ${planStep.capabilityId}`;
        stepResults.push({ capabilityId: planStep.capabilityId, ok: false, error: firstError });
        break;
      }
      try {
        // Each capability runs in its own Inngest step so failures resume
        // from the last success on retry.
        const out = await step.run(`exec-${i}-${cap.id}`, async () => {
          const parsed = cap.inputSchema.parse(planStep.input);
          return cap.execute(parsed, ctx);
        });
        stepResults.push({ capabilityId: cap.id, ok: true, output: out });
        // Best-effort signature extraction for write capabilities.
        if (out && typeof out === "object") {
          const o = out as Record<string, unknown>;
          if (typeof o.signature === "string") signature = o.signature;
          else if (typeof o.txSignature === "string") signature = o.txSignature;
        }
      } catch (err: any) {
        firstError = err?.message || String(err);
        stepResults.push({ capabilityId: cap.id, ok: false, error: firstError ?? undefined });
        break;
      }
    }

    const ok = firstError === null;
    const durationMs = Date.now() - startedAt;

    await step.run("settle-approval", async () => {
      if (!db) return;
      await db
        .update(commandApprovals)
        .set({
          status: ok ? "executed" : "approved",
          resolutionNote: ok
            ? `Executed ${stepResults.length}/${plan.steps.length} steps in ${durationMs}ms`
            : `Execution failed: ${firstError}`,
        })
        .where(eq(commandApprovals.id, approvalId));
    });

    await step.run("record-episode", async () => {
      await recordEpisode({
        commandId: row.commandId,
        walletAddress: row.walletAddress,
        intent,
        plan,
        outcome: ok ? "approved_executed" : "approved_failed",
        durationMs,
        signature: signature ?? undefined,
        notes: ok ? undefined : firstError ?? undefined,
      });
    });

    if (!ok) {
      await step.run("record-post-mortem", async () => {
        const failedStep = stepResults.find((s) => !s.ok);
        await recordPostMortem({
          commandId: row.commandId,
          walletAddress: row.walletAddress,
          intent,
          plan,
          failedCapabilityId: failedStep?.capabilityId ?? null,
          error: firstError ?? "unknown error",
          durationMs,
          signature,
        });
      });
    }

    await publish({
      name: "agent.command.completed",
      data: {
        commandId: row.commandId,
        walletAddress: row.walletAddress,
        decisionKind: decision.kind,
        completedAt: Date.now(),
      },
    });

    return { approvalId, ok, steps: stepResults.length, signature, durationMs };
  },
);
