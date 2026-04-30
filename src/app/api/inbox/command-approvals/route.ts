/**
 * GET   /api/inbox/command-approvals?wallet=&status=pending
 * PATCH /api/inbox/command-approvals  { id, status: 'approved'|'rejected', note? }
 *        On `approved`: synchronously runs the queued plan's capabilities to
 *        build a signing envelope (serializedTransactions + operation label),
 *        persists it onto `decision.signingEnvelope`, and returns it so the
 *        UI can hand it straight to the wallet for signing. The legacy
 *        Inngest executor still listens for `agent.approval.resolved` to
 *        record episodes / post-mortems.
 *
 * Best-effort: returns an empty list (not 500) when the table is missing,
 * so the inbox still loads on environments where the migration hasn't run.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { commandApprovals } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { publish } from "@/lib/agents/bus";
import { capabilityRegistry } from "@/lib/agents/capabilities/registry";
import type { CapabilityContext, ExecutionState } from "@/lib/agents/capabilities/types";
import type { Plan, RouteDecision } from "@/lib/agents/dacs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_MISSING = /relation .*command_approvals.* does not exist/i;

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ ok: true, approvals: [], reason: "db_unavailable" });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const status = url.searchParams.get("status") ?? "pending";

  try {
    const where = wallet
      ? and(eq(commandApprovals.status, status), eq(commandApprovals.walletAddress, wallet))
      : eq(commandApprovals.status, status);
    const rows = await db
      .select()
      .from(commandApprovals)
      .where(where)
      .orderBy(desc(commandApprovals.createdAt))
      .limit(50);
    return NextResponse.json({ ok: true, approvals: rows });
  } catch (err: any) {
    if (TABLE_MISSING.test(err?.message ?? "")) {
      return NextResponse.json({ ok: true, approvals: [], reason: "table_missing" });
    }
    console.warn("[inbox:command-approvals] GET failed", err?.message);
    return NextResponse.json({ ok: true, approvals: [], reason: "error" });
  }
}

interface SigningEnvelope {
  serializedTransactions: string[];
  operation: string;
  capabilityIds: string[];
  builtAt: number;
  buildErrors: string[];
}

/**
 * Walk the queued plan, run each capability with the user's wallet on
 * context, and collect any returned `serializedTransactions`. Read/sim/meta
 * steps are skipped — only write steps yield txs to sign.
 */
async function buildSigningEnvelope(
  plan: Plan,
  walletAddress: string | null,
): Promise<SigningEnvelope> {
  const registry = capabilityRegistry();
  const executionState: ExecutionState = {};
  const ctx: CapabilityContext = {
    walletAddress,
    rpcEndpoint: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    vaultState: null,
    walletState: null,
    executionState,
    promptMode: "execute",
    isStudioBuildIntent: false,
    blockExecutionForBuildIntent: () => null,
    resolveSplitAmount: (_t, requestedAmount) => ({
      amount: requestedAmount,
      adjusted: false,
      reason: undefined,
    }),
  };

  const serialized: string[] = [];
  const capabilityIds: string[] = [];
  const buildErrors: string[] = [];
  let operation = "Approved plan";

  for (const planStep of plan.steps ?? []) {
    const cap = registry.get(planStep.capabilityId);
    if (!cap) {
      buildErrors.push(`Unknown capability: ${planStep.capabilityId}`);
      continue;
    }
    if (cap.sideEffects !== "write") {
      // Read/sim/meta steps don't produce txs — skip them silently.
      continue;
    }
    try {
      const parsed = cap.inputSchema.parse(planStep.input);
      const out = (await cap.execute(parsed, ctx)) as Record<string, unknown> | undefined;
      capabilityIds.push(cap.id);
      if (out && typeof out === "object") {
        const txs = (out as { serializedTransactions?: unknown }).serializedTransactions;
        if (Array.isArray(txs)) {
          for (const t of txs) if (typeof t === "string") serialized.push(t);
        }
        const op = (out as { operation?: unknown }).operation;
        if (typeof op === "string" && op.length > 0) operation = op;
      }
    } catch (err: any) {
      buildErrors.push(`${cap.id}: ${err?.message ?? String(err)}`);
    }
  }

  return {
    serializedTransactions: serialized,
    operation,
    capabilityIds,
    builtAt: Date.now(),
    buildErrors,
  };
}

export async function PATCH(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  let body: { id?: string; status?: "approved" | "rejected" | "executed"; note?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body.id || !body.status || !["approved", "rejected", "executed"].includes(body.status)) {
    return NextResponse.json({ ok: false, error: "id_and_status_required" }, { status: 400 });
  }

  try {
    // Load existing row first so we can mutate `decision` JSON for approvals.
    const [existing] = await db
      .select()
      .from(commandApprovals)
      .where(eq(commandApprovals.id, body.id))
      .limit(1);
    if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

    let envelope: SigningEnvelope | null = null;
    let nextDecision = existing.decision as RouteDecision & { signingEnvelope?: SigningEnvelope };
    let resolutionNote = body.note ?? null;

    if (body.status === "approved") {
      try {
        envelope = await buildSigningEnvelope(
          existing.plan as unknown as Plan,
          existing.walletAddress,
        );
        nextDecision = { ...nextDecision, signingEnvelope: envelope };
        if (envelope.buildErrors.length > 0 && envelope.serializedTransactions.length === 0) {
          resolutionNote =
            resolutionNote ?? `Build failed: ${envelope.buildErrors.join("; ").slice(0, 380)}`;
        }
      } catch (e: any) {
        console.warn("[inbox:command-approvals] envelope build failed", e?.message);
        resolutionNote = resolutionNote ?? `Build failed: ${e?.message ?? "unknown"}`;
      }
    }

    if (body.status === "executed" && body.signature) {
      resolutionNote = resolutionNote ?? `Executed via wallet sign · ${body.signature.slice(0, 16)}…`;
    }

    const [row] = await db
      .update(commandApprovals)
      .set({
        status: body.status,
        resolvedAt: new Date(),
        resolutionNote,
        decision: nextDecision as unknown as Record<string, unknown>,
      })
      .where(eq(commandApprovals.id, body.id))
      .returning();

    // Fire DACS resolution event so the executor records episodes / post-mortems.
    try {
      await publish({
        name: "agent.approval.resolved",
        data: {
          approvalId: row.id,
          status: body.status,
          commandId: row.commandId,
          walletAddress: row.walletAddress,
        },
      });
    } catch (e: any) {
      console.warn("[inbox:command-approvals] publish failed", e?.message);
    }

    return NextResponse.json({ ok: true, approval: row, signingEnvelope: envelope });
  } catch (err: any) {
    if (TABLE_MISSING.test(err?.message ?? "")) {
      return NextResponse.json({ ok: false, error: "table_missing" }, { status: 503 });
    }
    console.warn("[inbox:command-approvals] PATCH failed", err?.message);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
