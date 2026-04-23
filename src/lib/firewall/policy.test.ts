/**
 * Simulation Firewall — Policy Engine Tests
 *
 * These tests pin the fail-closed behavior of the firewall. Every case
 * here represents a real attack surface that previously would have
 * silently passed via the deleted `mockSimulation` path.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_POLICY,
  FirewallBlockedError,
  enforce,
  enforceProgramAllowlist,
  evaluate,
} from "./policy";
import type { FirewallReport, SimulationResult } from "@/lib/studio/simulation-firewall";

function cleanQuote(): FirewallReport {
  return {
    passed: true,
    riskLevel: "low",
    checks: { priceImpact: "pass", outputNonZero: "pass", inputNonZero: "pass", routeExists: "pass", slippageGuard: "pass" },
    priceImpact: 0.1,
    outputAmount: "1000000",
    humanSummary: "All pre-flight checks passed",
  };
}

function cleanSim(): SimulationResult {
  return {
    success: true,
    balanceChanges: [
      { token: "SOL", before: 10, after: 9.9, change: -0.1, changeUsd: -23 },
      { token: "USDC", before: 0, after: 23, change: 23, changeUsd: 23 },
    ],
    estimatedFee: 0.000005,
    logs: ["Program log: ok"],
    unitsConsumed: 200_000,
    riskLevel: "low",
    humanSummary: "Swap simulated successfully",
  };
}

describe("FirewallPolicy.evaluate", () => {
  it("passes a clean low-risk swap", () => {
    const result = evaluate(cleanQuote(), cleanSim());
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.riskLevel).toBe("low");
  });

  it("blocks a quote with 7% price impact", () => {
    const q = cleanQuote();
    q.priceImpact = 7;
    const result = evaluate(q, cleanSim());
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("Price impact"))).toBe(true);
  });

  it("blocks a quote that already failed pre-flight checks", () => {
    const q = cleanQuote();
    q.passed = false;
    q.blockedReason = "Missing route plan";
    q.checks.routeExists = "fail";
    const result = evaluate(q, cleanSim());
    expect(result.passed).toBe(false);
  });

  it("blocks when fee exceeds policy cap", () => {
    const s = cleanSim();
    s.estimatedFee = 0.05;
    const result = evaluate(cleanQuote(), s);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("Fee"))).toBe(true);
  });

  it("blocks when on-chain simulation reports an error", () => {
    const s = cleanSim();
    s.success = false;
    s.error = "Custom program error: 0x1771";
    s.balanceChanges = [];
    const result = evaluate(cleanQuote(), s);
    expect(result.passed).toBe(false);
    expect(result.riskLevel).toBe("critical");
  });

  it("blocks when policy requires simulation but none was supplied", () => {
    const result = evaluate(cleanQuote(), null);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("simulation"))).toBe(true);
  });

  it("blocks when notional movement exceeds the cap", () => {
    const s = cleanSim();
    s.balanceChanges = [
      { token: "USDC", before: 0, after: 100_000, change: 100_000, changeUsd: 100_000 },
    ];
    const result = evaluate(cleanQuote(), s);
    expect(result.passed).toBe(false);
  });

  it("blocks when balance diff is required but missing", () => {
    const s = cleanSim();
    s.balanceChanges = [];
    const result = evaluate(cleanQuote(), s);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("balance diff"))).toBe(true);
  });
});

describe("FirewallPolicy.enforce", () => {
  it("returns evaluation on pass", () => {
    const res = enforce(cleanQuote(), cleanSim());
    expect(res.passed).toBe(true);
  });

  it("throws FirewallBlockedError on violation", () => {
    const q = cleanQuote();
    q.priceImpact = 9;
    expect(() => enforce(q, cleanSim())).toThrow(FirewallBlockedError);
  });
});

describe("FirewallPolicy.enforceProgramAllowlist", () => {
  it("throws when a blocked program is referenced", () => {
    const policy = { ...DEFAULT_POLICY, blockedPrograms: new Set(["BadProgram111111111111111111111111111111111"]) };
    expect(() =>
      enforceProgramAllowlist(["BadProgram111111111111111111111111111111111"], policy)
    ).toThrow(FirewallBlockedError);
  });

  it("passes when no blocked programs are touched", () => {
    expect(() =>
      enforceProgramAllowlist(["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"], DEFAULT_POLICY)
    ).not.toThrow();
  });
});
