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
import { capabilitySupportsChain, listCapabilities } from "./registry";
import type { AnyCapability, CapabilityChain, CapabilityContext, ExecutionState } from "./types";
import { gateFor, tierAllows, type Tier } from "../policy/tier-gate";

export interface BuildCapabilityContextInput {
  walletAddress: string | null;
  rpcEndpoint: string;
  vaultAddress?: string | null;
  vaultState: { tokens?: Array<Record<string, unknown>> } | null;
  walletState: { balances?: Array<Record<string, unknown>> } | null;
  executionState: ExecutionState;
  promptMode: "auto" | "build" | "execute";
  isStudioBuildIntent: boolean;
  blockExecutionForBuildIntent: CapabilityContext["blockExecutionForBuildIntent"];
  resolveSplitAmount: CapabilityContext["resolveSplitAmount"];
  /** D1 — currently-selected chain for this run. Defaults to "solana". */
  chain?: CapabilityChain;
  /** D1 — EVM chain id when chain==="evm". */
  chainId?: number;
}

/**
 * Assemble the unified `CapabilityContext` from the per-request closures
 * `route.ts` already constructs. Pure function — no side effects.
 */
export function buildCapabilityContext(input: BuildCapabilityContextInput): CapabilityContext {
  return {
    walletAddress: input.walletAddress,
    rpcEndpoint: input.rpcEndpoint,
    vaultAddress: input.vaultAddress ?? null,
    vaultState: input.vaultState,
    walletState: input.walletState,
    executionState: input.executionState,
    promptMode: input.promptMode,
    isStudioBuildIntent: input.isStudioBuildIntent,
    blockExecutionForBuildIntent: input.blockExecutionForBuildIntent,
    resolveSplitAmount: input.resolveSplitAmount,
    chain: input.chain ?? "solana",
    chainId: input.chainId,
  };
}

/**
 * Wrap a single Capability into an AI-SDK `tool({...})` definition that
 * closes over the request `ctx`.
 *
 * If `userTier` is provided, capabilities gated above that tier short-circuit
 * with a structured upgrade payload — the LLM is expected to surface this to
 * the user as a calm upgrade prompt rather than retrying.
 */
function capabilityToAITool(cap: AnyCapability, ctx: CapabilityContext, userTier?: Tier) {
  return tool({
    description: cap.description,
    inputSchema: cap.inputSchema,
    execute: async (input: unknown) => {
      // D1 — Reject capabilities that don't support the active chain. Mostly
      // catches `mode: "execute"` (write) capabilities being invoked while the
      // user is on EVM; native EVM signing is post-MVP.
      const chain: CapabilityChain = ctx.chain ?? "solana";
      if (!capabilitySupportsChain(cap, chain)) {
        return {
          ok: false,
          error: "chain_not_supported",
          blocked: true,
          capabilityId: cap.id,
          activeChain: chain,
          supportedChains: cap.supportedChains ?? ["solana"],
          message:
            chain === "evm"
              ? `${cap.id} is Solana-only today. Switch back to Solana to execute, or use the read-only EVM analytics + bridge-for-gas helpers instead.`
              : `${cap.id} doesn't support the ${chain} chain.`,
        };
      }
      if (userTier) {
        const required = gateFor(cap.id);
        if (!tierAllows(userTier, required)) {
          return {
            ok: false,
            error: "tier_gate_blocked",
            blocked: true,
            capabilityId: cap.id,
            requiredTier: required,
            userTier,
            upgradeUrl: "/app/billing",
            message: `This capability (${cap.id}) requires the ${required.toUpperCase()} plan. You're on ${userTier.toUpperCase()}. Upgrade at /app/billing to unlock it.`,
          };
        }
      }
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
 * Optional `only` filter restricts to a subset of capability ids.
 * Optional `userTier` enforces the same `CAPABILITY_TIER_GATES` map used by
 * the DACS planner — Free users get a structured upgrade payload back from
 * tool calls into Mini/Max-only capabilities.
 */
export function buildLegacyTools(
  ctx: CapabilityContext,
  options?: { only?: ReadonlySet<string>; userTier?: Tier },
): Record<string, ReturnType<typeof capabilityToAITool>> {
  const out: Record<string, ReturnType<typeof capabilityToAITool>> = {};
  for (const cap of listCapabilities()) {
    if (options?.only && !options.only.has(cap.id)) continue;
    out[cap.id] = capabilityToAITool(cap, ctx, options?.userTier);
  }
  return out;
}
