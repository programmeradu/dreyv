/**
 * POST /api/capabilities/run — executes a single read/meta capability and
 * returns the result. Side-effecting capabilities (write/sim) are blocked
 * here; they must go through the CommandBar planner so HITL/policy run.
 *
 * Body: { id: string; input?: Record<string, unknown> }
 */

import { NextResponse } from "next/server";
import { getCapability } from "@/lib/agents/capabilities/registry";
import type { CapabilityContext } from "@/lib/agents/capabilities/types";
export const runtime = "edge";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { id?: string; input?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ success: false, error: "id required" }, { status: 400 });
  }

  const cap = getCapability(id);
  if (!cap) {
    return NextResponse.json(
      { success: false, error: `unknown capability: ${id}` },
      { status: 404 },
    );
  }

  if (cap.sideEffects !== "read" && cap.sideEffects !== "meta") {
    return NextResponse.json(
      {
        success: false,
        error: `Capability '${id}' has side effects (${cap.sideEffects}). Run it through the CommandBar so policy + approvals apply.`,
        routeVia: "commandbar",
      },
      { status: 400 },
    );
  }

  // Validate input. If parse fails, surface what's missing.
  const parsed = cap.inputSchema.safeParse(body.input ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "invalid input — open the CommandBar to provide details.",
        issues: parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => ({ path: i.path, message: i.message })),
      },
      { status: 400 },
    );
  }

  // Minimal context for read/meta executors. They don't need wallet state.
  const ctx: CapabilityContext = {
    walletAddress: null,
    rpcEndpoint: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    vaultState: null,
    walletState: null,
    executionState: {},
    promptMode: "auto",
    isStudioBuildIntent: false,
    blockExecutionForBuildIntent: () => null,
    resolveSplitAmount: (_t, amount) => ({ amount, adjusted: false, reason: undefined }),
  };

  try {
    const out = await cap.execute(parsed.data, ctx);
    return NextResponse.json({ success: true, operation: id, result: out });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Capability execution failed.";
    return NextResponse.json({ success: false, operation: id, error: message }, { status: 500 });
  }
}
