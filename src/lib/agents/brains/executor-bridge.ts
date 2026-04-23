/**
 * Executor bridge — turns a high-confidence `DeepProposal` into a queued,
 * HITL-gated transaction proposal in `agent_tx_proposals`.
 *
 * We NEVER auto-sign. The bridge only:
 *   1. Filters proposals by confidence + non-`alert_only` actions.
 *   2. Resolves the first concrete action into either:
 *        - a serialized unsigned Solana transaction (single-wallet routing), or
 *        - a structured instructions blob (multisig routing via Squads).
 *   3. Inserts a row with `status = 'queued'`. A human approves via
 *      `PATCH /api/inbox/tx-proposals/:id { action: 'approve' | 'reject' }`.
 *
 * Designed to fail soft: any build error becomes a `failed` row with a
 * clear `error_message` so the operator can see what went wrong instead of
 * the pipeline silently dropping the proposal.
 */
import { db } from "@/db";
import { agentTxProposals } from "@/db/schema";
import type { DeepProposal } from "./gemini-deep";

const MIN_CONFIDENCE = 0.75;
const PROPOSAL_TTL_MS = 1000 * 60 * 30; // 30 min queue freshness

export interface ExecutableAction {
  op: DeepProposal["actions"][number]["op"];
  params: Record<string, unknown>;
  rationale: string;
}

export interface QueuedTxProposal {
  id: string;
  status: string;
  kind: string;
  summary: string;
}

function pickExecutable(proposal: DeepProposal): ExecutableAction | null {
  for (const a of proposal.actions ?? []) {
    if (a.op === "alert_only" || a.op === "spawn_subagent") continue;
    return a as ExecutableAction;
  }
  return null;
}

function summarize(proposal: DeepProposal, action: ExecutableAction): string {
  const p = action.params || {};
  switch (action.op) {
    case "swap":
      return `Swap ${p.amount ?? "?"} ${p.inputToken ?? p.inMint ?? "?"} → ${p.outputToken ?? p.outMint ?? "?"}`;
    case "stake":
      return `Stake ${p.amount ?? "?"} ${p.token ?? "SOL"}${p.validator ? ` via ${p.validator}` : ""}`;
    case "unstake":
      return `Unstake ${p.amount ?? "?"} ${p.token ?? "SOL"}`;
    case "deposit_yield":
      return `Deposit ${p.amount ?? "?"} ${p.token ?? "?"} into ${p.protocol ?? "yield"}`;
    case "withdraw":
      return `Withdraw ${p.amount ?? "?"} ${p.token ?? "?"}${p.protocol ? ` from ${p.protocol}` : ""}`;
    case "rebalance":
      return `Rebalance: ${proposal.title}`;
    default:
      return proposal.title;
  }
}

function riskLevelFor(action: ExecutableAction, confidence: number): "low" | "medium" | "high" {
  if (action.op === "rebalance") return "high";
  if (confidence >= 0.9) return "low";
  if (confidence >= 0.8) return "medium";
  return "high";
}

/**
 * Best-effort builder for a Jupiter swap ix bundle. We DO NOT sign here —
 * we just return the serialized unsigned tx (base64) for the wallet UI to
 * deserialize, sign, and submit. If the build fails (e.g. no RPC or
 * Jupiter outage), we return `null` and the caller stores `instructions`
 * as a structured fallback for later rebuild.
 */
async function tryBuildSwapTx(params: Record<string, unknown>): Promise<{
  unsignedTx: string | null;
  estimatedFeeSol: number | null;
}> {
  const inMint = String(params.inMint ?? params.inputToken ?? "");
  const outMint = String(params.outMint ?? params.outputToken ?? "");
  const amount = Number(params.amount ?? 0);
  if (!inMint || !outMint || !amount) return { unsignedTx: null, estimatedFeeSol: null };
  // We deliberately do not call Jupiter here — that requires a userPublicKey
  // we don't have at queue time. The wallet-side code (useTransactionExecutor)
  // already handles full quote → swap. We just stash the params so the
  // signer can rebuild on approval. This keeps the bridge synchronous and
  // safe in a serverless tick.
  return { unsignedTx: null, estimatedFeeSol: 0.000_05 };
}

export async function bridgeProposalToTx(args: {
  proposalId: string | null;
  userId: string | null;
  proposal: DeepProposal;
  multisigVault?: string | null;
}): Promise<QueuedTxProposal | null> {
  if (!db) {
    console.warn("[brains:bridge] DATABASE_URL missing — skipping tx queue");
    return null;
  }

  if (args.proposal.kind !== "proposal") return null;
  if (typeof args.proposal.confidence !== "number") return null;
  if (args.proposal.confidence < MIN_CONFIDENCE) return null;

  const action = pickExecutable(args.proposal);
  if (!action) return null;

  const routing: "wallet" | "multisig" = args.multisigVault ? "multisig" : "wallet";
  const summary = summarize(args.proposal, action);
  const risk = riskLevelFor(action, args.proposal.confidence);

  let unsignedTx: string | null = null;
  let estimatedFeeSol: number | null = null;
  let errorMessage: string | null = null;
  let status: "queued" | "failed" = "queued";

  try {
    if (action.op === "swap") {
      const built = await tryBuildSwapTx(action.params);
      unsignedTx = built.unsignedTx;
      estimatedFeeSol = built.estimatedFeeSol;
    }
  } catch (e: any) {
    errorMessage = e?.message?.slice(0, 500) ?? "build_failed";
    status = "failed";
  }

  try {
    const [row] = await db
      .insert(agentTxProposals)
      .values({
        proposalId: args.proposalId ?? null,
        userId: args.userId ?? null,
        chain: "solana",
        kind: action.op,
        summary,
        unsignedTx,
        instructions: [
          {
            op: action.op,
            params: action.params,
            rationale: action.rationale,
          },
        ] as unknown as object,
        estimatedFeeSol: estimatedFeeSol != null ? String(estimatedFeeSol) : null,
        riskLevel: risk,
        routing,
        multisigVault: args.multisigVault ?? null,
        status,
        errorMessage,
        meta: {
          confidence: args.proposal.confidence,
          horizon: args.proposal.horizon,
          model: args.proposal.model,
          riskNotes: args.proposal.riskNotes ?? [],
        } as unknown as object,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
      })
      .returning({
        id: agentTxProposals.id,
        status: agentTxProposals.status,
        kind: agentTxProposals.kind,
        summary: agentTxProposals.summary,
      });
    return row as QueuedTxProposal;
  } catch (e: any) {
    console.warn("[brains:bridge] tx queue insert failed", e?.message);
    return null;
  }
}
