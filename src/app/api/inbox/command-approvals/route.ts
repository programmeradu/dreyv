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
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { commandApprovals } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { publish } from "@/lib/agents/bus";
import { getAuthUser } from "@/lib/auth-utils";
import { capabilityRegistry } from "@/lib/agents/capabilities/registry";
import type { CapabilityContext, ExecutionState } from "@/lib/agents/capabilities/types";
import type { Plan, RouteDecision } from "@/lib/agents/dacs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_MISSING = /relation .*command_approvals.* does not exist/i;

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ ok: true, approvals: [], reason: "db_unavailable" });
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  // Always scope to the authenticated user's wallet, regardless of any
  // ?wallet= query (which may come from a different connected wallet than
  // the JWT cookie's wallet — e.g. user reconnected with another adapter).
  const wallet = user.walletAddress;

  try {
    const where = and(eq(commandApprovals.status, status), eq(commandApprovals.walletAddress, wallet));
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

interface ExtraSigner {
  publicKey: string;
  secretKeyBase64: string;
}

/**
 * How the wallet should land a multi-tx envelope:
 *   - "sequential": signAllTransactions, then send each tx via the regular RPC
 *     loop. Default for swaps and simple multi-step plans. One popup; N
 *     independent on-chain landings.
 *   - "atomic": signAllTransactions, then submit the whole batch via Jito
 *     bundle so all txs land in the same slot or none of them do. Reserved
 *     for high-risk multi-leg flows (rebalance, mass payout, stablecoin
 *     diversification) where partial execution is unacceptable.
 */
export type BundleStrategy = "sequential" | "atomic";

interface ReadResult {
  capabilityId: string;
  sideEffects: string;
  summary?: string;
  output: unknown;
}

interface SigningEnvelope {
  serializedTransactions: string[];
  /** Per-tx ephemeral signers (e.g. Squads createKey). Index-aligned with serializedTransactions. */
  extraSigners: ExtraSigner[][];
  operation: string;
  capabilityIds: string[];
  bundleStrategy: BundleStrategy;
  /** Capability ids that opted into atomic bundling (for diagnostics + UI tooltips). */
  atomicCapabilityIds: string[];
  builtAt: number;
  buildErrors: string[];
  /** Outputs from read-only / sim / meta steps so the UI can render the
   *  approved plan's actual deliverable (briefings, projections, summaries)
   *  instead of silently discarding them. */
  readResults: ReadResult[];
}

/**
 * Capability ids whose multi-tx output should be Jito-bundled by default.
 * Capabilities can also opt in dynamically by returning bundleStrategy:
 * "atomic" on the execute() result; this list covers the legacy outputs
 * that don't yet emit that field.
 */
const ATOMIC_BUNDLE_CAPABILITY_IDS = new Set<string>([
  "rebalance",
  "mass_dispatch",
  "stablecoin_diversification",
]);

/**
 * Walk the queued plan, run each capability with the user's wallet on
 * context, and collect any returned `serializedTransactions` plus optional
 * `extraSigners` (ephemeral keypairs that must co-sign before the wallet,
 * e.g. Squads `createKey`). Read/sim/meta steps are skipped.
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
  const extraSigners: ExtraSigner[][] = [];
  const capabilityIds: string[] = [];
  const atomicCapabilityIds: string[] = [];
  const buildErrors: string[] = [];
  let operation = "Approved plan";
  let bundleStrategy: BundleStrategy = "sequential";

  for (const planStep of plan.steps ?? []) {
    const cap = registry.get(planStep.capabilityId);
    if (!cap) {
      buildErrors.push(`Unknown capability: ${planStep.capabilityId}`);
      continue;
    }
    if (cap.sideEffects !== "write") {
      continue;
    }
    try {
      const parsed = cap.inputSchema.parse(planStep.input);
      const out = (await cap.execute(parsed, ctx)) as Record<string, unknown> | undefined;
      capabilityIds.push(cap.id);
      let stepWantsAtomic = ATOMIC_BUNDLE_CAPABILITY_IDS.has(cap.id);
      if (out && typeof out === "object") {
        const txs = (out as { serializedTransactions?: unknown }).serializedTransactions;
        const sigs = (out as { extraSigners?: unknown }).extraSigners;
        const stepStrategy = (out as { bundleStrategy?: unknown }).bundleStrategy;
        if (stepStrategy === "atomic") stepWantsAtomic = true;
        const stepSigners: ExtraSigner[] = Array.isArray(sigs)
          ? (sigs as any[]).filter(
              (s) =>
                s &&
                typeof s.publicKey === "string" &&
                typeof s.secretKeyBase64 === "string",
            )
          : [];
        if (Array.isArray(txs)) {
          for (const t of txs) {
            if (typeof t === "string") {
              serialized.push(t);
              // Apply this step's extra signers to every tx the step produced.
              extraSigners.push(stepSigners);
            }
          }
        }
        const op = (out as { operation?: unknown }).operation;
        if (typeof op === "string" && op.length > 0) operation = op;
      }
      if (stepWantsAtomic) {
        atomicCapabilityIds.push(cap.id);
        bundleStrategy = "atomic";
      }
    } catch (err: any) {
      buildErrors.push(`${cap.id}: ${err?.message ?? String(err)}`);
    }
  }

  // Jito bundles cap at 5 transactions. If a capability requested atomic but
  // the resulting envelope has more than 5 txs, we fall back to sequential
  // and surface a build error so the UI can warn the user.
  if (bundleStrategy === "atomic" && serialized.length > 5) {
    buildErrors.push(
      `bundle_too_large_for_atomic: ${serialized.length} txs > 5 (Jito limit). Falling back to sequential.`,
    );
    bundleStrategy = "sequential";
  }

  return {
    serializedTransactions: serialized,
    extraSigners,
    operation,
    capabilityIds,
    bundleStrategy,
    atomicCapabilityIds,
    builtAt: Date.now(),
    buildErrors,
  };
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
    if (existing.walletAddress && existing.walletAddress !== user.walletAddress) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

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

    // Fire DACS resolution event ONLY for rejected/expired so the executor
    // records a learning episode. Approved plans are signed in-UI by the
    // wallet path; settling the row to `executed` (with the resulting
    // signature) closes the loop without re-running capabilities headlessly.
    if (body.status === "rejected") {
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
