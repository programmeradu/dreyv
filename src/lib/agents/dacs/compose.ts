/**
 * DACS Phase 2 — Open-vocabulary planner sandbox + risk veto.
 *
 * The deterministic planner (plan.ts) emits CapabilityCalls strictly from the
 * registered capability set. This module wraps any planner output that wants
 * to *compose* capabilities into novel macros, and applies two gates before
 * the router ever sees it:
 *
 *   1. Allowlist  — every step must reference a registered capability
 *                   (no hallucinated tool names).
 *   2. Risk veto  — any step touching a protocol outside the user's
 *                   allowlist (when defined) is stripped or the whole plan
 *                   is rejected.
 *
 * Why a separate module? Phase 3 adds dynamic capabilities that emit
 * `DynamicCapabilitySpec` and run inside a sandbox-runner. We want a single
 * choke-point for "can this composed plan even be considered" so the
 * router and the dynamic-tool sandbox share one veto path.
 */

import { capabilityRegistry } from "../capabilities/registry";
import type { Plan, RouteDecision } from "./types";
import type { RouteOptions } from "./route";

export interface ComposeVerdict {
  ok: boolean;
  plan: Plan;
  /** Steps that were rejected (kept for logging / transparency). */
  rejectedSteps: Array<{ capabilityId: string; reason: string }>;
  /** If `ok: false`, a RouteDecision the caller can return verbatim. */
  rejection?: RouteDecision;
}

/**
 * Validate + sanitize a composed plan before routing.
 *
 * - Drops steps with unknown capabilityIds (planner hallucination).
 * - Drops steps that violate the per-user protocol allowlist.
 * - If all steps are dropped, returns a `reject` RouteDecision so the
 *   caller can short-circuit without going through the normal router.
 */
export function verifyComposedPlan(
  plan: Plan,
  options: RouteOptions = {},
): ComposeVerdict {
  const registry = capabilityRegistry();
  const allowlist = options.policy?.protocolAllowlist ?? [];
  const denylist = options.policy?.protocolDenylist ?? [];
  const rejected: ComposeVerdict["rejectedSteps"] = [];

  const acceptedSteps = plan.steps.filter((step) => {
    const cap = registry.get(step.capabilityId);
    if (!cap) {
      rejected.push({
        capabilityId: step.capabilityId,
        reason: "Unknown capability — not in registry.",
      });
      return false;
    }
    const protos = cap.protocols ?? [];
    if (denylist.length && protos.some((p) => denylist.includes(p))) {
      rejected.push({
        capabilityId: step.capabilityId,
        reason: `Protocol(s) on user denylist: ${protos.filter((p) => denylist.includes(p)).join(", ")}`,
      });
      return false;
    }
    if (allowlist.length && protos.length && !protos.some((p) => allowlist.includes(p))) {
      rejected.push({
        capabilityId: step.capabilityId,
        reason: `No allowlisted protocol (capability touches ${protos.join(", ")}).`,
      });
      return false;
    }
    return true;
  });

  const sanitized: Plan = { ...plan, steps: acceptedSteps };

  if (acceptedSteps.length === 0) {
    return {
      ok: false,
      plan: sanitized,
      rejectedSteps: rejected,
      rejection: {
        kind: "reject",
        plan: sanitized,
        reason:
          rejected.length > 0
            ? `All composed steps rejected: ${rejected
                .map((r) => `${r.capabilityId} (${r.reason})`)
                .join("; ")}`
            : "Composed plan produced no executable steps.",
      },
    };
  }

  return { ok: true, plan: sanitized, rejectedSteps: rejected };
}
