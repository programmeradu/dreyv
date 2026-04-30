/**
 * DACS Phase 1 — Router.
 *
 * Pure decision function: given an Intent + Plan + per-user policy hints,
 * decide whether to auto-execute, queue for HITL approval, ask for
 * clarification, defer to a sub-agent, or reject.
 *
 * Phase 1 ships with conservative defaults (every write → HITL). Phase 3
 * loads `user_agent_policy` to relax for users who opted into thresholds.
 */

import { listCapabilities } from "../capabilities/registry";
import type { Intent, Plan, RouteDecision } from "./types";

export interface RouteOptions {
  /** Per-user policy. Phase 1 leaves this defaulted; Phase 3 fills it. */
  policy?: {
    autoApproveBelowUsd?: number;
    requireMultisigAboveUsd?: number;
    protocolAllowlist?: string[];
    protocolDenylist?: string[];
  };
  /** Build mode short-circuits financial executions. */
  promptMode?: "auto" | "build" | "execute";
  isStudioBuildIntent?: boolean;
}

const DEFAULT_AUTO_APPROVE_USD = 0; // safest default: no auto-approve writes
const HIGH_RISK_THRESHOLD = 0.7;

export function routePlan(intent: Intent, plan: Plan, options: RouteOptions = {}): RouteDecision {
  // 1. Empty plan with clarifications → ask.
  if (plan.steps.length === 0) {
    if (plan.needsClarification?.length) {
      return {
        kind: "ask_clarification",
        plan,
        reason: "Plan needs more information.",
        clarifications: plan.needsClarification,
      };
    }
    return { kind: "reject", plan, reason: plan.rationale || "No actionable steps." };
  }

  const caps = listCapabilities();
  const byId = new Map(caps.map((c) => [c.id, c]));

  // 2. Build-mode short-circuit: forbid write-side financial steps.
  if (options.promptMode === "build" || options.isStudioBuildIntent) {
    const blockingStep = plan.steps.find((s) => {
      const c = byId.get(s.capabilityId);
      return c && c.sideEffects === "write" && c.domain !== "studio" && c.domain !== "policy";
    });
    if (blockingStep) {
      return {
        kind: "reject",
        plan,
        reason: `Build-mode active: blocked write capability ${blockingStep.capabilityId}.`,
      };
    }
  }

  // 3. Protocol allowlist/denylist gate.
  if (options.policy?.protocolDenylist?.length) {
    const denied = plan.steps.find((s) => {
      const c = byId.get(s.capabilityId);
      return (c?.protocols || []).some((p) => options.policy!.protocolDenylist!.includes(p));
    });
    if (denied) {
      return {
        kind: "reject",
        plan,
        reason: `Plan touches denylisted protocol via ${denied.capabilityId}.`,
      };
    }
  }
  if (options.policy?.protocolAllowlist?.length) {
    const offending = plan.steps.find((s) => {
      const c = byId.get(s.capabilityId);
      const protos = c?.protocols || [];
      return protos.length > 0 && !protos.some((p) => options.policy!.protocolAllowlist!.includes(p));
    });
    if (offending) {
      return {
        kind: "queue_for_approval",
        plan,
        reason: `Plan uses protocol outside allowlist (${offending.capabilityId}).`,
      };
    }
  }

  // 4. Side-effect classification.
  const allRead = plan.steps.every((s) => {
    const c = byId.get(s.capabilityId);
    return c && (c.sideEffects === "read" || c.sideEffects === "sim" || c.sideEffects === "meta");
  });

  if (allRead) {
    return { kind: "auto_execute", plan, reason: "All steps are read/sim/meta." };
  }

  // 5. Write path: gate on risk + value + policy.
  const valueUsd = plan.estimatedValueUsd;
  const autoCap = options.policy?.autoApproveBelowUsd ?? DEFAULT_AUTO_APPROVE_USD;

  if (plan.riskScore >= HIGH_RISK_THRESHOLD) {
    return { kind: "queue_for_approval", plan, reason: `High risk score ${plan.riskScore.toFixed(2)}.` };
  }

  if (plan.reversibility === "irreversible") {
    return { kind: "queue_for_approval", plan, reason: "Plan is irreversible." };
  }

  // Unknown value on a write path → never silently auto-execute. The
  // synthesizer often omits estimatedValueUsd for trades; treating that as
  // $0 (≤ autoCap) caused real swaps to bypass HITL entirely. Require a
  // numeric value AND an explicit policy opt-in (autoCap > 0) to auto-run.
  if (valueUsd == null || !Number.isFinite(valueUsd)) {
    return {
      kind: "queue_for_approval",
      plan,
      reason: "Write step has no estimated USD value — routing to approval.",
    };
  }

  if (autoCap <= 0 || valueUsd > autoCap) {
    return {
      kind: "queue_for_approval",
      plan,
      reason: autoCap <= 0
        ? "No auto-approve policy set — write requires approval."
        : `Value $${valueUsd} exceeds auto-approve cap $${autoCap}.`,
    };
  }

  return { kind: "auto_execute", plan, reason: "Within policy auto-approve limits." };
}
