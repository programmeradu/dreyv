/**
 * DACS Phase 5 — Specialist agent registry + dispatcher.
 *
 * Each specialist owns a slice of the capability surface and returns an
 * `AgentReport` to the orchestrator (commandRouter). Phase 5 ships the
 * registry, intent → specialist routing, and a stub `runSpecialist` that
 * produces a structured report. Real handoff execution (separate Inngest
 * functions per specialist) lands in Phase 5.1.
 *
 * Cross-Agent Treasury Protocol envelope (CATP) — open, versioned schema so
 * external agents can integrate as specialists later.
 */
import type { Intent, Plan } from "./types";

export type SpecialistId =
  | "treasury-agent"
  | "trading-agent"
  | "yield-agent"
  | "research-agent"
  | "builder-agent"
  | "risk-agent"
  | "payments-agent"
  | "policy-agent"
  | "navigator-agent";

export interface SpecialistSpec {
  id: SpecialistId;
  name: string;
  domains: string[]; // capability domains owned
  handles: Intent["kind"][]; // intent kinds dispatched here
  description: string;
}

export const SPECIALISTS: SpecialistSpec[] = [
  {
    id: "treasury-agent",
    name: "Treasury Specialist",
    domains: ["treasury"],
    handles: ["treasury_action"],
    description: "Transfers, multisig proposals, mass dispatch, runway autopilot.",
  },
  {
    id: "trading-agent",
    name: "Trading Specialist",
    domains: ["trading"],
    handles: ["trade"],
    description: "Swaps, bridges, sniper bots, route optimization.",
  },
  {
    id: "yield-agent",
    name: "Yield Specialist",
    domains: ["yield"],
    handles: ["yield_action"],
    description: "Stake/unstake, deposit/withdraw, DCA, rebalancing.",
  },
  {
    id: "research-agent",
    name: "Research Specialist",
    domains: ["intel"],
    handles: ["research"],
    description: "Price/APY/risk/audit/sentiment/IDL/SDK lookups, browser research.",
  },
  {
    id: "builder-agent",
    name: "Builder Specialist",
    domains: ["studio", "dynamic"],
    handles: ["build"],
    description: "Mini-app scaffolding, code analysis, dynamic-tool composition.",
  },
  {
    id: "risk-agent",
    name: "Risk Specialist",
    domains: ["risk"],
    handles: ["risk_check"],
    description: "Counterparty risk, liquidation watch, attestations, hedging.",
  },
  {
    id: "payments-agent",
    name: "Payments Specialist",
    domains: ["payments"],
    handles: ["payment"],
    description: "Recurring payments, invoices, grants, gas-tank top-ups.",
  },
  {
    id: "policy-agent",
    name: "Policy Specialist",
    domains: ["policy"],
    handles: ["policy_setup"],
    description: "Treasury policy, allowlists, runway floor, attestations.",
  },
  {
    id: "navigator-agent",
    name: "Navigator",
    domains: ["misc"],
    handles: ["navigate", "chitchat", "monitor", "unknown"],
    description: "Lightweight UX nav, watchers handoff, fallback chat.",
  },
];

const INTENT_INDEX: Map<string, SpecialistId> = (() => {
  const m = new Map<string, SpecialistId>();
  for (const s of SPECIALISTS) for (const k of s.handles) m.set(k, s.id);
  return m;
})();

export function pickSpecialist(intent: Intent): SpecialistSpec {
  const id = INTENT_INDEX.get(intent.kind) ?? "navigator-agent";
  return SPECIALISTS.find((s) => s.id === id)!;
}

/**
 * Cross-Agent Treasury Protocol — handoff envelope.
 * Versioned so external agents can integrate without breaking changes.
 */
export interface HandoffEnvelope {
  catpVersion: "1.0";
  commandId: string;
  walletAddress: string | null;
  specialist: SpecialistId;
  intent: Intent;
  plan: Plan;
  context: {
    promptMode: "auto" | "build" | "execute";
    submittedAt: number;
  };
}

export interface AgentReport {
  catpVersion: "1.0";
  commandId: string;
  specialist: SpecialistId;
  status: "accepted" | "completed" | "rejected" | "deferred";
  summary: string;
  artifacts?: Array<{ kind: string; ref: string }>;
  followUps?: string[];
  durationMs?: number;
}

export function buildEnvelope(args: {
  commandId: string;
  walletAddress: string | null;
  intent: Intent;
  plan: Plan;
  promptMode: "auto" | "build" | "execute";
  submittedAt: number;
}): HandoffEnvelope {
  return {
    catpVersion: "1.0",
    commandId: args.commandId,
    walletAddress: args.walletAddress,
    specialist: pickSpecialist(args.intent).id,
    intent: args.intent,
    plan: args.plan,
    context: { promptMode: args.promptMode, submittedAt: args.submittedAt },
  };
}

/**
 * Phase 5 stub: produces a structured `AgentReport` describing what the
 * specialist *would* do. Phase 5.1 will replace this with per-specialist
 * Inngest functions that execute the plan slice they own.
 */
export function runSpecialistStub(env: HandoffEnvelope): AgentReport {
  const { specialist, intent, plan, commandId } = env;
  return {
    catpVersion: "1.0",
    commandId,
    specialist,
    status: "accepted",
    summary: `${specialist} acknowledged ${intent.kind} plan with ${plan.steps.length} step(s); risk ${plan.riskScore.toFixed(2)}.`,
    followUps: plan.needsClarification ?? [],
  };
}
