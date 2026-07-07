/**
 * Simulation Firewall — Policy Engine
 *
 * Hard, fail-closed risk policy applied to every transaction-producing
 * operation in the platform. Quote pre-flight + on-chain simulation are
 * both evaluated against this policy. Any violation throws
 * `FirewallBlockedError` and prevents the transaction from being signed.
 */

import type { FirewallReport, SimulationResult } from "@/lib/studio/simulation-firewall";
import type { RiskLevel as WebacyRiskLevel, RiskScore as WebacyRiskScore } from "@/lib/webacy/types";

/**
 * Optional Webacy address-risk summary supplied to the firewall.
 * When omitted, no address-risk check is enforced (fail-open on read).
 * When supplied with a level >= policy.maxAddressRisk the tx is blocked.
 */
export interface WebacyAddressSummary {
  worst: WebacyRiskLevel;
  addresses: WebacyRiskScore[];
}

export interface FirewallPolicy {
  /** Max acceptable price impact, in percent (e.g. 1.0 = 1%). */
  maxPriceImpactPct: number;
  /** Max acceptable slippage in bps (1 bps = 0.01%). */
  maxSlippageBps: number;
  /** Max acceptable on-chain network fee, in SOL. */
  maxTxFeeSol: number;
  /** Max acceptable USD-denominated notional movement per tx. */
  maxNotionalUsd: number;
  /** Program IDs that are always blocked (known drainers, etc.). */
  blockedPrograms: Set<string>;
  /** When true, every transaction MUST be simulated (no skip path). */
  requireSimulation: true;
  /** When true, the simulation MUST return real pre/post balance diffs. */
  requireBalanceDiff: true;
  /**
   * Highest Webacy address risk that is still ALLOWED to sign. Anything
   * strictly above this level is blocked. Only enforced when a
   * `WebacyAddressSummary` is supplied. Default: allow up to "medium"
   * (block on "high").
   */
  maxAddressRisk: "safe" | "medium" | "high";
}

/**
 * Default production policy. Tuned conservatively — callers may pass a
 * stricter policy but should not relax these defaults at the call site.
 */
export const DEFAULT_POLICY: FirewallPolicy = {
  maxPriceImpactPct: 1.0,
  maxSlippageBps: 100,
  maxTxFeeSol: 0.01,
  maxNotionalUsd: 50_000,
  blockedPrograms: new Set<string>([
    // Known malicious / drainer program IDs go here. Empty by default;
    // add via env-driven override or admin tooling.
  ]),
  requireSimulation: true,
  requireBalanceDiff: true,
  maxAddressRisk: "high",
};

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface PolicyEvaluation {
  passed: boolean;
  violations: string[];
  riskLevel: RiskLevel;
}

/**
 * Thrown whenever the firewall blocks a transaction.
 * Callers should treat this as an unrecoverable, user-facing block.
 */
export class FirewallBlockedError extends Error {
  public readonly violations: string[];
  public readonly riskLevel: RiskLevel;

  constructor(message: string, violations: string[] = [], riskLevel: RiskLevel = "critical") {
    super(message);
    this.name = "FirewallBlockedError";
    this.violations = violations;
    this.riskLevel = riskLevel;
  }
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["low", "medium", "high", "critical"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

/**
 * Evaluate a quote pre-flight report and (optionally) an on-chain
 * simulation result against the supplied policy.
 *
 * Throws `FirewallBlockedError` on any policy violation. Returns a
 * structured evaluation otherwise.
 */
export function evaluate(
  report: FirewallReport | null,
  simResult: SimulationResult | null,
  policy: FirewallPolicy = DEFAULT_POLICY,
  webacy: WebacyAddressSummary | null = null
): PolicyEvaluation {
  const violations: string[] = [];
  let risk: RiskLevel = "low";

  // ─── Quote pre-flight checks ──────────────────────────────────────
  if (report) {
    if (!report.passed) {
      violations.push(report.blockedReason || "Pre-flight checks failed");
      risk = maxRisk(risk, report.riskLevel);
    }
    if (report.priceImpact > policy.maxPriceImpactPct) {
      violations.push(
        `Price impact ${report.priceImpact}% exceeds policy max ${policy.maxPriceImpactPct}%`
      );
      risk = maxRisk(risk, "high");
    }
  }

  // ─── On-chain simulation checks ───────────────────────────────────
  if (policy.requireSimulation && !simResult) {
    violations.push("Policy requires on-chain simulation but none was provided");
    risk = "critical";
  }

  if (simResult) {
    if (!simResult.success) {
      violations.push(simResult.error || "On-chain simulation failed");
      risk = "critical";
    }
    if (simResult.estimatedFee > policy.maxTxFeeSol) {
      violations.push(
        `Fee ${simResult.estimatedFee} SOL exceeds policy max ${policy.maxTxFeeSol} SOL`
      );
      risk = maxRisk(risk, "high");
    }
    if (policy.requireBalanceDiff && simResult.success && simResult.balanceChanges.length === 0) {
      violations.push("Policy requires real pre/post balance diff — none returned by simulation");
      risk = maxRisk(risk, "high");
    }

    // Notional cap (sum of absolute USD movement across changes)
    const notionalUsd = simResult.balanceChanges.reduce(
      (sum, c) => sum + Math.abs(c.changeUsd || 0),
      0
    );
    if (notionalUsd > policy.maxNotionalUsd) {
      violations.push(
        `Notional movement $${notionalUsd.toFixed(2)} exceeds policy max $${policy.maxNotionalUsd}`
      );
      risk = maxRisk(risk, "high");
    }

    risk = maxRisk(risk, simResult.riskLevel);
  }

  // ─── Webacy address risk (Simulation Firewall pre-sign) ───────────
  if (webacy && webacy.addresses.length > 0) {
    const rank = (l: "safe" | "medium" | "high") => (l === "safe" ? 0 : l === "medium" ? 1 : 2);
    const capRank = rank(policy.maxAddressRisk);
    const flagged = webacy.addresses.filter(
      (a) => a.level === "medium" || a.level === "high"
    );
    const worstRank = webacy.worst === "high" ? 2 : webacy.worst === "medium" ? 1 : 0;
    if (worstRank > capRank) {
      const top = flagged
        .filter((a) => (policy.maxAddressRisk === "medium" ? true : a.level === "high"))
        .slice(0, 3)
        .map((a) => `${a.subject.slice(0, 8)}… (${a.flags.slice(0, 2).join(", ") || a.level})`)
        .join("; ");
      violations.push(`Webacy flagged risky addresses in this tx: ${top}`);
      risk = maxRisk(risk, "high");
    } else if (flagged.length > 0) {
      // In-band warning surface — never blocks by itself, just raises the risk band.
      risk = maxRisk(risk, "medium");
    }
  }

  const passed = violations.length === 0;
  return { passed, violations, riskLevel: risk };
}

/**
 * Convenience wrapper — runs `evaluate` and throws if blocked.
 */
export function enforce(
  report: FirewallReport | null,
  simResult: SimulationResult | null,
  policy: FirewallPolicy = DEFAULT_POLICY,
  webacy: WebacyAddressSummary | null = null
): PolicyEvaluation {
  const result = evaluate(report, simResult, policy, webacy);
  if (!result.passed) {
    throw new FirewallBlockedError(
      `Firewall blocked: ${result.violations.join("; ")}`,
      result.violations,
      result.riskLevel
    );
  }
  return result;
}

/**
 * Check whether any of the supplied program IDs is on the blocklist.
 * Throws `FirewallBlockedError` if so.
 */
export function enforceProgramAllowlist(
  programIds: Iterable<string>,
  policy: FirewallPolicy = DEFAULT_POLICY
): void {
  const hits: string[] = [];
  for (const id of programIds) {
    if (policy.blockedPrograms.has(id)) hits.push(id);
  }
  if (hits.length > 0) {
    throw new FirewallBlockedError(
      `Firewall blocked: transaction touches blocked programs: ${hits.join(", ")}`,
      hits.map((p) => `Blocked program: ${p}`),
      "critical"
    );
  }
}
