/**
 * GET   /api/inbox/tx-proposals?wallet=&status=queued — list HITL tx proposals.
 * PATCH /api/inbox/tx-proposals — { id, action, signature?, errorMessage? }
 *   action: 'approve' | 'reject' | 'submitted' | 'confirmed' | 'failed'
 *
 * The wallet/multisig signer pulls a row, signs locally, then PATCHes
 * back with the resulting signature. We never sign server-side.
 */
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";
import {
  listQueuedTxProposals,
  updateTxProposalStatus,
  resolveUserIdFromWallet,
  getTxProposal,
  insertTxProposal,
  type InsertTxProposalInput,
} from "@/lib/agents/brains/storage";
import { scoreAddresses, scoreTransaction, worstOfMap } from "@/lib/webacy/service";
import type { RiskLevel, RiskScore } from "@/lib/webacy/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const status = url.searchParams.get("status") ?? "queued";
  const userId = wallet ? await resolveUserIdFromWallet(wallet) : null;
  const rows = await listQueuedTxProposals(100, { userId, status });
  return NextResponse.json({ ok: true, txProposals: rows, scopedTo: userId ?? null });
}

const VALID_ACTIONS = new Set(["approve", "reject", "submitted", "confirmed", "failed"]);

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type WebacyTxMeta = {
  webacyTxRisk?: RiskScore;
  webacyAddressRisk?: {
    worst: RiskLevel;
    scores: RiskScore[];
  };
  webacyRiskAcceptedAt?: string;
};

function normalizeChainForWebacy(chain?: string | null): string {
  const c = (chain ?? "solana").toLowerCase();
  if (c === "solana") return "sol";
  return c;
}

function mergeRiskLevel(current: unknown, webacyWorst: RiskLevel): "low" | "medium" | "high" {
  if (webacyWorst === "high") return "high";
  if (webacyWorst === "medium") return current === "high" ? "high" : "medium";
  return current === "low" || current === "medium" || current === "high" ? current : "medium";
}

function collectAddressCandidates(value: unknown, acc = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (SOLANA_ADDRESS_RE.test(value)) acc.add(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAddressCandidates(item, acc);
    return acc;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectAddressCandidates(v, acc);
  }
  return acc;
}

async function buildWebacyMeta(input: {
  chain?: string | null;
  unsignedTx?: string | null;
  instructions?: unknown[] | null;
  signer?: string | null;
  existingMeta?: Record<string, unknown> | null;
}): Promise<{ meta: Record<string, unknown>; worst: RiskLevel }> {
  const chain = normalizeChainForWebacy(input.chain);
  const meta: Record<string, unknown> = { ...(input.existingMeta ?? {}) };
  let worst: RiskLevel = "unknown";

  if (input.unsignedTx) {
    const score = await scoreTransaction({ chain, serializedTx: input.unsignedTx, signer: input.signer ?? undefined });
    meta.webacyTxRisk = score;
    worst = score.level;
  }

  const addresses = Array.from(collectAddressCandidates(input.instructions ?? [])).slice(0, 20);
  if (addresses.length > 0) {
    const scores = await scoreAddresses(addresses, chain);
    const addressWorst = worstOfMap(scores);
    meta.webacyAddressRisk = { worst: addressWorst, scores: Array.from(scores.values()) };
    if (addressWorst === "high" || (addressWorst === "medium" && worst !== "high")) worst = addressWorst;
  }

  return { meta, worst };
}

function existingWebacyWorst(meta: unknown): RiskLevel {
  const m = meta && typeof meta === "object" ? (meta as WebacyTxMeta) : null;
  const txLevel = m?.webacyTxRisk?.level ?? "unknown";
  const addrLevel = m?.webacyAddressRisk?.worst ?? "unknown";
  if (txLevel === "high" || addrLevel === "high") return "high";
  if (txLevel === "medium" || addrLevel === "medium") return "medium";
  if (txLevel === "safe" || addrLevel === "safe") return "safe";
  if (txLevel === "safest" || addrLevel === "safest") return "safest";
  return "unknown";
}

/**
 * POST /api/inbox/tx-proposals — enqueue a HITL tx proposal.
 *
 * Body:
 *   {
 *     wallet?: string;            // resolved → userId
 *     kind: string;               // 'mass-send' | 'transfer' | 'swap' | ...
 *     summary: string;
 *     instructions?: unknown[];   // structured ix list (preferred for mass-send)
 *     unsignedTx?: string;        // OR a base64 unsigned tx
 *     riskLevel?: 'low'|'medium'|'high';
 *     routing?: 'wallet'|'multisig';
 *     multisigVault?: string;
 *     estimatedFeeSol?: number;
 *     meta?: Record<string, unknown>;
 *     ttlMinutes?: number;
 *   }
 */
export async function POST(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Partial<InsertTxProposalInput> & { wallet?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body?.kind || !body?.summary) {
    return NextResponse.json({ ok: false, error: "kind_and_summary_required" }, { status: 400 });
  }
  const userId = body.wallet ? await resolveUserIdFromWallet(body.wallet) : null;
  const webacy = await buildWebacyMeta({
    chain: body.chain ?? "solana",
    unsignedTx: body.unsignedTx ?? null,
    instructions: body.instructions ?? null,
    signer: body.wallet ?? null,
    existingMeta: body.meta ?? null,
  });

  const row = await insertTxProposal({
    userId,
    proposalId: body.proposalId ?? null,
    chain: body.chain ?? "solana",
    kind: body.kind,
    summary: body.summary,
    unsignedTx: body.unsignedTx ?? null,
    instructions: body.instructions ?? null,
    estimatedFeeSol: body.estimatedFeeSol ?? null,
    riskLevel: mergeRiskLevel(body.riskLevel, webacy.worst),
    routing: body.routing ?? "wallet",
    multisigVault: body.multisigVault ?? null,
    meta: webacy.meta,
    ttlMinutes: body.ttlMinutes ?? 60,
  });
  if (!row) {
    return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: row.id });
}

export async function PATCH(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    id?: string;
    action?: string;
    signature?: string;
    errorMessage?: string;
    webacyRiskAccepted?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { id, action } = body;
  if (!id || !action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "bad_args" }, { status: 400 });
  }

  const existing = await getTxProposal(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  if (action === "approve" && existingWebacyWorst(existing.meta) === "high" && !body.webacyRiskAccepted) {
    return NextResponse.json(
      {
        ok: false,
        error: "webacy_high_risk_confirmation_required",
        message: "Webacy flagged this transaction as high risk. Confirm once more to approve.",
        webacy: existing.meta,
      },
      { status: 409 },
    );
  }

  const statusMap: Record<string, "approved" | "rejected" | "submitted" | "confirmed" | "failed"> = {
    approve: "approved",
    reject: "rejected",
    submitted: "submitted",
    confirmed: "confirmed",
    failed: "failed",
  };

  const ok = await updateTxProposalStatus(id, {
    status: statusMap[action],
    signature: body.signature ?? null,
    errorMessage: body.errorMessage ?? null,
    metaPatch:
      action === "approve" && body.webacyRiskAccepted
        ? { webacyRiskAcceptedAt: new Date().toISOString() }
        : undefined,
  });

  return NextResponse.json({ ok, id, status: statusMap[action] });
}
