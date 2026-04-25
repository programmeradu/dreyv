/**
 * DACS Phase 0 — Capability type system.
 *
 * Every legacy CommandBar tool (and every future capability) is described by a
 * `Capability` object: a typed schema, a side-effect classification, an auth
 * requirement, a sensitivity score, and an executor that receives a unified
 * `CapabilityContext` instead of closing over request-scope state.
 *
 * Purpose:
 *   - Phase 1+ planner can reason about side-effects + sensitivity without
 *     reading 2,500 lines of route.ts.
 *   - Risk-agent can veto plans that touch protocols outside user policy.
 *   - HITL queue can pre-decide approval routing from `sideEffects`/`sensitivity`.
 *   - Sandbox runner can refuse to compose write capabilities the user hasn't
 *     opted into.
 */

import type { z } from "zod";

/**
 * SideEffect classifies what touching this capability does.
 *   - read:    no on-chain state change, no external state change. Safe to run autonomously.
 *   - sim:     runs a simulation/forecast; does not touch chain or external accounts.
 *   - write:   produces a transaction the user must sign, or queues a proposal.
 *   - meta:    UI/navigation effect only (e.g. navigate(), monitor setup that lives in our DB).
 */
export type SideEffect = "read" | "sim" | "write" | "meta";

/**
 * RequiredAuth tells the router what the executor needs to function.
 *   - none:      runs anonymously
 *   - wallet:    needs walletAddress on context
 *   - multisig:  needs walletAddress AND a Squads multisig at that address
 */
export type RequiredAuth = "none" | "wallet" | "multisig";

/**
 * Sensitivity feeds the HITL router.
 *   - low:    can auto-execute given user policy
 *   - medium: prefer HITL even with policy unless explicitly opted in
 *   - high:   always HITL (irreversible, large value, multi-recipient, cross-chain, etc.)
 */
export type Sensitivity = "low" | "medium" | "high";

/**
 * Domains group capabilities for review + module organization.
 */
export type CapabilityDomain =
  | "treasury"
  | "trading"
  | "yield"
  | "intel"
  | "studio"
  | "dynamic"
  | "misc"
  | "policy"
  | "payments"
  | "risk";

/**
 * Mutable per-request execution state. Lives for one HTTP request /
 * one DACS command run. Used by tools to chain output of one call into the
 * input of another (e.g. "swap then deposit the result").
 */
export interface ExecutionState {
  lastSwap?: {
    inputToken: string;
    outputToken: string;
    inputAmount: number;
    outputAmount: number;
  };
  splitFirstLegApplied?: boolean;
  splitRemaining?: number;
}

/**
 * The unified context every executor receives. Replaces ad-hoc closures
 * over `walletAddress`, `rpcEndpoint`, `vaultState`, etc. that the legacy
 * route.ts relied on.
 */
export interface CapabilityContext {
  walletAddress: string | null;
  rpcEndpoint: string;
  vaultState: { tokens?: Array<Record<string, unknown>> } | null;
  walletState: { balances?: Array<Record<string, unknown>> } | null;
  /** Mutable; executors may write to it (e.g. record lastSwap for split workflow). */
  executionState: ExecutionState;
  /** "auto" | "build" | "execute" — gates whether financial execution tools can run. */
  promptMode: "auto" | "build" | "execute";
  /** True when the LLM/router classified the intent as Studio scaffolding. */
  isStudioBuildIntent: boolean;
  /**
   * Returns a structured "blocked" payload if the capability shouldn't run
   * because the user is in build-intent mode. Returns null otherwise.
   * Treasury/trading/yield capabilities short-circuit on this.
   */
  blockExecutionForBuildIntent(operation: string): null | {
    success: false;
    operation: string;
    status: "BLOCKED_IN_BUILD_MODE";
    requiresApproval: false;
    mode: "auto" | "build" | "execute";
    message: string;
  };
  /**
   * Resolves a requested amount in the context of a previous swap output
   * (e.g. "deposit the rest" / "deposit half"). Returns the same amount and
   * `adjusted: false` when there's no prior swap to chain off of.
   */
  resolveSplitAmount(
    token: string,
    requestedAmount: number,
  ): {
    amount: number;
    adjusted: boolean;
    reason: string | undefined;
  };
}

/**
 * The contract every capability must satisfy.
 *
 * `inputSchema` and `outputSchema` are zod schemas; `execute` is invoked with
 * the parsed input and the request context. All side-effect / auth / sensitivity
 * metadata is declarative so planners and risk-agents can reason about it
 * before actually running anything.
 */
export interface Capability<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = unknown,
> {
  id: string;
  domain: CapabilityDomain;
  description: string;
  inputSchema: TInput;
  /**
   * Optional output schema. Many legacy executors return loose `Record<string, unknown>`
   * shapes; we mark this optional so we can migrate without forcing a contract
   * change in the same pass.
   */
  outputSchema?: z.ZodTypeAny;
  sideEffects: SideEffect;
  requiredAuth: RequiredAuth;
  sensitivity: Sensitivity;
  /**
   * Optional list of protocol identifiers this capability touches (e.g. "marinade",
   * "kamino", "rango"). Risk-agent uses this to enforce per-user protocol allowlists.
   */
  protocols?: string[];
  execute: (
    input: z.infer<TInput>,
    ctx: CapabilityContext,
  ) => Promise<TOutput>;
}

/**
 * Convenience factory so domain modules don't have to repeat the generic
 * constraint signature. Lets us write:
 *   defineCapability({ id: "swap", inputSchema: z.object({...}), execute: async (input, ctx) => {...}, ... })
 */
export function defineCapability<TInput extends z.ZodTypeAny, TOutput>(
  spec: Capability<TInput, TOutput>,
): Capability<TInput, TOutput> {
  return spec;
}

/**
 * Erased Capability type for places that hold heterogeneous capabilities in
 * arrays/maps (registry, domain exports). The generic is bivariant under the
 * `any` parameter, so a `Capability<SpecificSchema, SpecificOutput>` is
 * assignable to `AnyCapability` without TS variance complaints.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCapability = Capability<any, any>;
