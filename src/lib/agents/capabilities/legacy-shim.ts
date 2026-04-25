/**
 * DACS Phase 0 — Legacy CommandBar tool shim.
 *
 * Bridges the new capability registry (`src/lib/agents/capabilities/`) into
 * the AI SDK `tool({...})` shape that `src/app/api/command/route.ts` currently
 * passes to `streamText({ tools })`.
 *
 * Usage in route.ts (Phase 0 cutover, byte-compatible):
 *   const ctx = buildCapabilityContext({ walletAddress, rpcEndpoint, ... });
 *   const registryTools = buildLegacyTools(ctx);
 *   // then merge `registryTools` into `keystoneTools` (registry wins on overlap).
 *
 * Phase 6 deletes the inline `keystoneTools` object entirely and uses
 * `registryTools` directly.
 */

import { tool } from "ai";
import { listCapabilities } from "./registry";
import type { AnyCapability, CapabilityContext, ExecutionState } from "./types";

export interface BuildCapabilityContextInput {
  walletAddress: string | null;
  rpcEndpoint: string;
  vaultState: { tokens?: Array<Record<string, unknown>> } | null;
  walletState: { balances?: Array<Record<string, unknown>> } | null;
  executionState: ExecutionState;
  promptMode: "auto" | "build" | "execute";
  isStudioBuildIntent: boolean;
  blockExecutionForBuildIntent: CapabilityContext["blockExecutionForBuildIntent"];
  resolveSplitAmount: CapabilityContext["resolveSplitAmount"];
}

/**
 * Assemble the unified `CapabilityContext` from the per-request closures
 * `route.ts` already constructs. Pure function — no side effects.
 */
export function buildCapabilityContext(input: BuildCapabilityContextInput): CapabilityContext {
  return {
    walletAddress: input.walletAddress,
    rpcEndpoint: input.rpcEndpoint,
    vaultState: input.vaultState,
    walletState: input.walletState,
    executionState: input.executionState,
    promptMode: input.promptMode,
    isStudioBuildIntent: input.isStudioBuildIntent,
    blockExecutionForBuildIntent: input.blockExecutionForBuildIntent,
    resolveSplitAmount: input.resolveSplitAmount,
  };
}

/**
 * Wrap a single Capability into an AI-SDK `tool({...})` definition that
 * closes over the request `ctx`.
 */
function capabilityToAITool(cap: AnyCapability, ctx: CapabilityContext) {
  return tool({
    description: cap.description,
    inputSchema: cap.inputSchema,
    execute: async (input: unknown) => {
      // Re-validate at execution time so the shim mirrors the per-tool
      // safety the AI SDK already applies; capability executors expect
      // parsed input.
      const parsed = cap.inputSchema.parse(input);
      return cap.execute(parsed, ctx);
    },
  });
}

/**
 * Build a `Record<string, AISDKTool>` for every capability in the registry,
 * keyed by capability id. Drop-in compatible with the legacy `keystoneTools`
 * object: `{ ...keystoneTools, ...buildLegacyTools(ctx) }` works.
 *
 * Optional `only` filter restricts to a subset of capability ids — used by
 * the Phase 0 shadow rollout to migrate one tool at a time.
 */
export function buildLegacyTools(
  ctx: CapabilityContext,
  options?: { only?: ReadonlySet<string> },
): Record<string, ReturnType<typeof capabilityToAITool>> {
  const out: Record<string, ReturnType<typeof capabilityToAITool>> = {};
  for (const cap of listCapabilities()) {
    if (options?.only && !options.only.has(cap.id)) continue;
    out[cap.id] = capabilityToAITool(cap, ctx);
  }
  return out;
}
