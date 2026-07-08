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
import { scoreTransaction } from "@/lib/webacy/service";
import type { RiskLevel, RiskScore } from "@/lib/webacy/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_MISSING = /relation .*command_approvals.* does not exist/i;

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ ok: true, approvals: [], reason: "db_unavailable" });
  const url = new URL(req.url);
  // Accept ?status=pending (default) or ?status=approved,executed
  const statusParam = url.searchParams.get("status") ?? "pending";
  const statuses = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
  const wallet = user.walletAddress;

  try {
    const { inArray } = await import("drizzle-orm");
    const where = and(
      inArray(commandApprovals.status, statuses),
      eq(commandApprovals.walletAddress, wallet),
    );
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
  webacyTxRisk?: {
    worst: RiskLevel;
    scores: RiskScore[];
  };
}

function worstWebacy(scores: RiskScore[]): RiskLevel {
  if (scores.some((s) => s.level === "high")) return "high";
  if (scores.some((s) => s.level === "medium")) return "medium";
  if (scores.some((s) => s.level === "safe")) return "safe";
  if (scores.some((s) => s.level === "safest")) return "safest";
  return "unknown";
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
  const readResults: ReadResult[] = [];
  let operation = "Approved plan";
  let bundleStrategy: BundleStrategy = "sequential";

  for (const planStep of plan.steps ?? []) {
    const cap = registry.get(planStep.capabilityId);
    if (!cap) {
      buildErrors.push(`Unknown capability: ${planStep.capabilityId}`);
      continue;
    }
    try {
      const parsed = cap.inputSchema.parse(planStep.input);
      const out = (await cap.execute(parsed, ctx)) as Record<string, unknown> | undefined;
      capabilityIds.push(cap.id);

      // Non-write steps (read/sim/meta): capture the output so the UI can
      // render the actual deliverable (briefing, projection, summary).
      if (cap.sideEffects !== "write") {
        const summary =
          out && typeof out === "object"
            ? (typeof (out as any).summary === "string" && (out as any).summary) ||
              (typeof (out as any).narrative === "string" && (out as any).narrative) ||
              (typeof (out as any).message === "string" && (out as any).message) ||
              undefined
            : undefined;
        readResults.push({
          capabilityId: cap.id,
          sideEffects: cap.sideEffects,
          summary: summary || undefined,
          output: out ?? null,
        });
        continue;
      }

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

  if (bundleStrategy === "atomic" && serialized.length > 5) {
    buildErrors.push(
      `bundle_too_large_for_atomic: ${serialized.length} txs > 5 (Jito limit). Falling back to sequential.`,
    );
    bundleStrategy = "sequential";
  }

  const webacyScores = serialized.length > 0
    ? await Promise.all(serialized.map((serializedTx) => scoreTransaction({ chain: "sol", serializedTx, signer: walletAddress ?? undefined })))
    : [];

  return {
    serializedTransactions: serialized,
    extraSigners,
    operation,
    capabilityIds,
    bundleStrategy,
    atomicCapabilityIds,
    builtAt: Date.now(),
    buildErrors,
    readResults,
    webacyTxRisk: webacyScores.length > 0 ? { worst: worstWebacy(webacyScores), scores: webacyScores } : undefined,
  };
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  let body: { id?: string; status?: "approved" | "rejected" | "executed"; note?: string; signature?: string; webacyRiskAccepted?: boolean };
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
    let effectiveStatus: "approved" | "rejected" | "executed" = body.status;

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
        if (envelope.webacyTxRisk?.worst === "high" && !body.webacyRiskAccepted) {
          return NextResponse.json(
            {
              ok: false,
              error: "webacy_high_risk_confirmation_required",
              message: "Webacy flagged this signing envelope as high risk. Confirm once more to approve.",
              signingEnvelope: envelope,
            },
            { status: 409 },
          );
        }
        // Read-only plan (briefing / projection / summary): no txs to sign,
        // no build errors → mark executed so it lands in the Completed tab
        // with its readResults instead of vanishing.
        if (
          envelope.serializedTransactions.length === 0 &&
          envelope.buildErrors.length === 0
        ) {
          effectiveStatus = "executed";
          const firstSummary = envelope.readResults.find((r) => r.summary)?.summary;
          resolutionNote =
            resolutionNote ??
            (firstSummary
              ? firstSummary.slice(0, 380)
              : `Delivered ${envelope.readResults.length} read-only result${
                  envelope.readResults.length === 1 ? "" : "s"
                }.`);
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
        status: effectiveStatus,
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
