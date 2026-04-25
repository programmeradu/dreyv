/**
 * DACS Phase 5.1 — Specialist runtime.
 *
 * Each specialist in `SPECIALISTS` becomes an Inngest function that listens
 * on `agent.handoff.requested`, filters envelopes targeted at its own id,
 * and executes the read/sim slice of the plan it owns. Write-side steps are
 * NOT executed here — those still flow through the HITL approval queue and
 * `executeApprovedPlan`. This keeps Phase 5.1 safe-by-default while giving
 * each specialist a real runtime that emits a structured `AgentReport`.
 *
 * Concurrency is capped at 5 per specialist to respect free-tier Inngest
 * limits (the same cap the command router and executor already use).
 */
import { inngest } from "../inngest-client";
import { publish } from "../bus";
import { capabilityRegistry } from "../capabilities/registry";
import type { CapabilityContext, ExecutionState, anyCapability } from "../capabilities/types";
import {
  SPECIALISTS,
  type AgentReport,
  type HandoffEnvelope,
  type SpecialistId,
  type SpecialistSpec,
} from "./specialists";

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

/**
 * A capability "belongs" to a specialist when its domain overlaps with the
 * specialist's declared domains. Steps outside that slice are skipped (they
 * are owned by another specialist or by the executor).
 */
function ownsCapability(spec: SpecialistSpec, cap: anyCapability): boolean {
  return spec.domains.includes(cap.domain);
}

/** Read/sim/meta side effects are safe to run in the specialist runtime. */
function isSafeSideEffect(cap: anyCapability): boolean {
  return cap.sideEffects === "read" || cap.sideEffects === "sim" || cap.sideEffects === "meta";
}

interface StepResult {
  capabilityId: string;
  ok: boolean;
  skipped?: "not_owned" | "write_side_effect" | "unknown_capability";
  output?: unknown;
  error?: string;
}

function makeSpecialistFunction(spec: SpecialistSpec) {
  return inngest.createFunction(
    {
      id: `dacs-specialist-${spec.id}`,
      name: `DACS · Specialist · ${spec.name}`,
      concurrency: { limit: 5 },
      retries: 1,
    },
    { event: "agent.handoff.requested" },
    async ({ event, step }) => {
      const envelope = event.data?.envelope as HandoffEnvelope | undefined;
      if (!envelope || envelope.specialist !== spec.id) {
        // Not addressed to this specialist; ignore quietly.
        return { skipped: true, reason: "not_target" };
      }

      const startedAt = Date.now();
      const { commandId, walletAddress, intent, plan } = envelope;
      const ctx = buildHeadlessContext(walletAddress);
      const registry = capabilityRegistry();

      const stepResults: StepResult[] = [];
      let firstError: string | null = null;

      for (let i = 0; i < plan.steps.length; i++) {
        const planStep = plan.steps[i];
        const cap = registry.get(planStep.capabilityId);
        if (!cap) {
          stepResults.push({
            capabilityId: planStep.capabilityId,
            ok: false,
            skipped: "unknown_capability",
          });
          continue;
        }
        if (!ownsCapability(spec, cap)) {
          stepResults.push({ capabilityId: cap.id, ok: true, skipped: "not_owned" });
          continue;
        }
        if (!isSafeSideEffect(cap)) {
          // Write-side steps are deferred to the HITL executor; specialist
          // only previews them here.
          stepResults.push({ capabilityId: cap.id, ok: true, skipped: "write_side_effect" });
          continue;
        }
        try {
          const out = await step.run(`${spec.id}-exec-${i}-${cap.id}`, async () => {
            const parsed = cap.inputSchema.parse(planStep.input);
            return cap.execute(parsed, ctx);
          });
          stepResults.push({ capabilityId: cap.id, ok: true, output: out });
        } catch (err: unknown) {
          firstError = err instanceof Error ? err.message : String(err);
          stepResults.push({ capabilityId: cap.id, ok: false, error: firstError });
          break;
        }
      }

      const owned = stepResults.filter((s) => s.skipped !== "not_owned");
      const executed = owned.filter((s) => s.ok && !s.skipped);
      const deferred = owned.filter((s) => s.skipped === "write_side_effect");
      const ok = firstError === null;
      const durationMs = Date.now() - startedAt;

      const status: AgentReport["status"] = !ok
        ? "rejected"
        : deferred.length > 0
          ? "deferred"
          : executed.length > 0
            ? "completed"
            : "accepted";

      const summary = !ok
        ? `${spec.name} failed on ${owned.length} owned step(s): ${firstError}`
        : `${spec.name} handled ${executed.length} read/sim step(s)` +
          (deferred.length ? `, deferred ${deferred.length} write step(s) to HITL executor` : "") +
          ` in ${durationMs}ms.`;

      const report: AgentReport = {
        catpVersion: "1.0",
        commandId,
        specialist: spec.id,
        status,
        summary,
        artifacts: executed
          .filter((s) => s.output && typeof s.output === "object")
          .map((s) => ({ kind: "capability_output", ref: s.capabilityId })),
        followUps: plan.needsClarification ?? [],
        durationMs,
      };

      await step.run("publish-report", async () => {
        await publish({
          name: "agent.handoff.reported",
          data: {
            commandId,
            walletAddress,
            report,
            stepResults,
            intentKind: intent.kind,
          },
        });
      });

      return { ok, status, executed: executed.length, deferred: deferred.length };
    },
  );
}

/** One Inngest function per registered specialist. */
export const SPECIALIST_FUNCTIONS = SPECIALISTS.map(makeSpecialistFunction);

export const SPECIALIST_FUNCTION_IDS: SpecialistId[] = SPECIALISTS.map((s) => s.id);
