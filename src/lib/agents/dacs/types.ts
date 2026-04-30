/**
 * DACS Phase 1 — typed shapes shared across intent / plan / route / sse-proxy.
 *
 * Intent: classified user request (kind, entities, constraints, ambiguities).
 * Plan:   ordered CapabilityCall list with rationale + risk_score + reversibility.
 * Decision: router output (auto-exec, queue-for-approval, ask-clarification, reject).
 *
 * All four are JSON-serializable so they can flow over the bus and be replayed
 * in shadow-mode diff harness.
 */

import { z } from "zod";

export type IntentKind =
  | "treasury_action"
  | "trade"
  | "yield_action"
  | "research"
  | "build"
  | "monitor"
  | "policy_setup"
  | "payment"
  | "risk_check"
  | "navigate"
  | "chitchat"
  | "unknown";

export const intentSchema = z.object({
  kind: z.string().describe("One of IntentKind"),
  entities: z.record(z.unknown()).describe("Extracted entities: token, amount, recipient, protocol, etc."),
  constraints: z.record(z.unknown()).describe("Slippage caps, deadlines, mode flags, etc."),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string()).describe("Open questions that may need clarification."),
  rawText: z.string(),
});
export type Intent = z.infer<typeof intentSchema>;

export const capabilityCallSchema = z.object({
  capabilityId: z.string(),
  input: z.record(z.unknown()),
  rationale: z.string().optional(),
});
export type CapabilityCall = z.infer<typeof capabilityCallSchema>;

export const planSchema = z.object({
  steps: z.array(capabilityCallSchema),
  rationale: z.string(),
  reversibility: z.enum(["reversible", "partial", "irreversible"]),
  riskScore: z.number().min(0).max(1),
  estimatedValueUsd: z.number().optional(),
  needsClarification: z.array(z.string()).optional(),
});
export type Plan = z.infer<typeof planSchema>;

export type RouteDecisionKind =
  | "auto_execute"
  | "queue_for_approval"
  | "ask_clarification"
  | "reject"
  | "defer_to_subagent";

export interface RouteDecision {
  kind: RouteDecisionKind;
  plan: Plan;
  reason: string;
  approvalQueueId?: string;
  clarifications?: string[];
}

export interface CommandSubmittedPayload {
  commandId: string;
  walletAddress: string | null;
  /** Active vault address from VaultContext — may be a Squads multisig or a plain wallet. Falls back to walletAddress when null. */
  vaultAddress?: string | null;
  rawText: string;
  promptMode: "auto" | "build" | "execute";
  vaultState: { tokens?: Array<Record<string, unknown>> } | null;
  walletState: { balances?: Array<Record<string, unknown>> } | null;
  submittedAt: number;
}
