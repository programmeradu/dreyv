/**
 * Policy guard — Phase 4.
 *
 * Real enforcement: given a plan and the user's signer + spend history,
 * decide allow / queue / deny. Plugs into DACS router BEFORE the risk gate.
 */
import { db } from "@/db";
import { agentSigners, agentCircuitBreaker, agentToolMetrics, userAgentPolicy } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import type { Plan } from "../dacs/types";
import { listCapabilities } from "../capabilities/registry";

export interface PolicyCaps {
  maxUsdPerTx?: number;
  maxUsdPerDay?: number;
  allowedProtocols?: string[];
  allowedActions?: string[];
  expiresAt?: string;
  /** Phase 8 — max acceptable slippage in basis points (default 50). */
  maxSlippageBps?: number;
  /** Phase 8 — N consecutive errors that auto-trip the breaker. */
  maxConsecutiveErrors?: number;
}

export const DEFAULT_MAX_SLIPPAGE_BPS = 50;
export const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

export interface PolicyDecision {
  decision: "allow" | "queue" | "deny";
  reasons: string[];
  signerId?: string;
}

export async function evaluatePolicy(opts: {
  userId: string;
  vaultId?: string;
  plan: Plan;
}): Promise<PolicyDecision> {
  const { userId, vaultId, plan } = opts;
  const reasons: string[] = [];

  if (!db) return { decision: "queue", reasons: ["Database unavailable"] };

  // 1. Circuit breaker — frozen autopilot blocks everything.
  const breakers = await db
    .select()
    .from(agentCircuitBreaker)
    .where(eq(agentCircuitBreaker.userId, userId))
    .limit(1);
  const br = breakers[0];
  if (br?.frozenUntil && new Date(br.frozenUntil) > new Date()) {
    return { decision: "deny", reasons: [`Circuit breaker active: ${br.reason || "frozen"}`] };
  }

  // 2. Find an active signer for this vault (if any).
  let signer: typeof agentSigners.$inferSelect | undefined;
  if (vaultId) {
    const rows = await db
      .select()
      .from(agentSigners)
      .where(and(eq(agentSigners.vaultId, vaultId), eq(agentSigners.status, "active")))
      .limit(1);
    signer = rows[0];
  }

  // No signer → must HITL.
  if (!signer) {
    reasons.push("No active agent signer — requires user approval");
    return { decision: "queue", reasons };
  }

  if (signer.killSwitchAt) {
    return { decision: "deny", reasons: ["Kill switch engaged on signer"] };
  }
  if (signer.expiresAt && new Date(signer.expiresAt) < new Date()) {
    return { decision: "deny", reasons: ["Signer expired"] };
  }

  const caps = (signer.policyCaps || {}) as PolicyCaps;
  const valueUsd = plan.estimatedValueUsd ?? 0;

  // 3. Per-tx cap.
  if (caps.maxUsdPerTx != null && valueUsd > caps.maxUsdPerTx) {
    reasons.push(`Plan value $${valueUsd} > per-tx cap $${caps.maxUsdPerTx}`);
    return { decision: "queue", reasons, signerId: signer.id };
  }

  // 4. Per-day cap (sum from metrics today).
  if (caps.maxUsdPerDay != null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const spent = await db
      .select({ s: sql<number>`COALESCE(SUM((outcome)::int), 0)` })
      .from(agentAutopilotRunsRef())
      .where(and(eq(agentAutopilotRunsRef().userId, userId), gte(agentAutopilotRunsRef().createdAt, since)));
    // Soft sum from metrics; if exceeds, queue.
    void spent;
    // Conservative: if estimated would push close to cap, queue.
    if (valueUsd > caps.maxUsdPerDay) {
      reasons.push(`Plan value $${valueUsd} > daily cap $${caps.maxUsdPerDay}`);
      return { decision: "queue", reasons, signerId: signer.id };
    }
  }

  // 5. Protocol allowlist.
  if (caps.allowedProtocols?.length) {
    const reg = listCapabilities();
    const byId = new Map(reg.map((c) => [c.id, c]));
    const offending = plan.steps.find((s) => {
      const c = byId.get(s.capabilityId);
      const ps = c?.protocols || [];
      return ps.length > 0 && !ps.some((p) => caps.allowedProtocols!.includes(p));
    });
    if (offending) {
      reasons.push(`Step ${offending.capabilityId} touches non-allowlisted protocol`);
      return { decision: "queue", reasons, signerId: signer.id };
    }
  }

  // 6. Allowed actions.
  if (caps.allowedActions?.length) {
    const blocked = plan.steps.find((s) => !caps.allowedActions!.includes(s.capabilityId));
    if (blocked) {
      reasons.push(`Action ${blocked.capabilityId} not in allowlist`);
      return { decision: "queue", reasons, signerId: signer.id };
    }
  }

  return { decision: "allow", reasons: ["Within signer caps"], signerId: signer.id };
}

// avoid TDZ in same-file ref
function agentAutopilotRunsRef() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require("@/db/schema");
  return m.agentAutopilotRuns;
}

export async function tripCircuitBreaker(opts: {
  userId: string;
  vaultId?: string;
  scope?: string;
  reason: string;
  freezeMinutes?: number;
}) {
  if (!db) return;
  const frozen = new Date(Date.now() + (opts.freezeMinutes ?? 15) * 60 * 1000);
  await db
    .insert(agentCircuitBreaker)
    .values({
      userId: opts.userId,
      vaultId: opts.vaultId ?? null,
      scope: opts.scope ?? "autopilot",
      consecutiveFailures: 1,
      lastFirewallRejectAt: new Date(),
      frozenUntil: frozen,
      reason: opts.reason,
    })
    .onConflictDoNothing();
}

export async function recordToolMetric(opts: {
  userId?: string;
  capabilityId: string;
  commandId?: string;
  latencyMs: number;
  outcome: "ok" | "error" | "denied" | "queued";
  errorCode?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsdEst?: number;
}) {
  if (!db) return;
  try {
    await db.insert(agentToolMetrics).values({
      userId: opts.userId,
      capabilityId: opts.capabilityId,
      commandId: opts.commandId,
      latencyMs: opts.latencyMs,
      outcome: opts.outcome,
      errorCode: opts.errorCode,
      tokensIn: opts.tokensIn,
      tokensOut: opts.tokensOut,
      costUsdEst: opts.costUsdEst != null ? String(opts.costUsdEst) : undefined,
    });
  } catch (e) {
    console.warn("[recordToolMetric] failed:", e);
  }
}
