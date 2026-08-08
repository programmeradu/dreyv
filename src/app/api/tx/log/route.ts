import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactionCache, agentExecutions, protocolFees } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";
import { TREASURY_WALLET } from "@/lib/commandbar/protocol-fee";

export const dynamic = "force-dynamic";

interface ProtocolFeePayload {
  parentSignature: string;
  feeSignature: string;
  feeLamports: number;
  feeUsd: number;
}

interface LogPayload {
  signatures: string[];
  operation?: string;
  toolName?: string;
  prompt?: string;
  vaultAddress?: string | null;
  estimatedValueUsd?: number | null;
  source?: "commandbar" | "agent" | "manual";
  protocolFee?: ProtocolFeePayload | null;
}

export async function POST(req: NextRequest) {
  try {
    if (!db) return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });

    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as LogPayload | null;
    if (!body || !Array.isArray(body.signatures) || body.signatures.length === 0) {
      return NextResponse.json({ ok: false, error: "no_signatures" }, { status: 400 });
    }

    const operation = (body.operation || body.toolName || "command").toString().slice(0, 120);
    const source = body.source || "commandbar";
    const valueUsd = typeof body.estimatedValueUsd === "number" ? body.estimatedValueUsd : null;
    const now = new Date();

    const txRows = body.signatures.map((sig) => ({
      userId: user.id,
      walletAddress: user.walletAddress,
      signature: sig,
      success: true,
      type: source === "commandbar" ? ("commandbar" as const) : ("program" as const),
      direction: "out" as const,
      programId: null,
      memo: operation,
      valueUsd: valueUsd != null ? String(valueUsd) : null,
      rawData: { source, operation, prompt: body.prompt ?? null, vaultAddress: body.vaultAddress ?? null },
      createdAt: now,
    }));

    await db
      .insert(transactionCache)
      .values(txRows)
      .onConflictDoNothing({ target: transactionCache.signature });

    // Protocol fee ledger — one row per 0.05% skim collected by the wallet.
    if (body.protocolFee && body.protocolFee.feeSignature && body.protocolFee.feeUsd > 0) {
      try {
        await db
          .insert(protocolFees)
          .values({
            userId: user.id,
            walletAddress: user.walletAddress,
            parentSignature: body.protocolFee.parentSignature,
            feeSignature: body.protocolFee.feeSignature,
            operation,
            source,
            estimatedValueUsd: valueUsd != null ? String(valueUsd) : null,
            feeUsd: String(body.protocolFee.feeUsd),
            feeLamports: String(body.protocolFee.feeLamports),
            treasuryWallet: TREASURY_WALLET,
            createdAt: now,
          })
          .onConflictDoNothing({ target: protocolFees.feeSignature });
      } catch (e) {
        console.warn("[/api/tx/log] protocol_fees insert failed", e);
      }
    }

    const execId = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await db
      .insert(agentExecutions)
      .values({
        id: execId,
        userId: user.id,
        walletAddress: user.walletAddress,
        strategy: source === "commandbar" ? "commandbar_action" : operation,
        status: "SUCCESS",
        progress: 100,
        input: { operation, prompt: body.prompt ?? null, toolName: body.toolName ?? null, source },
        result: { signatures: body.signatures, valueUsd, protocolFeeUsd: body.protocolFee?.feeUsd ?? null },
        transactionSignature: body.signatures[0],
        approvalRequired: false,
        startedAt: now,
        completedAt: now,
      })
      .onConflictDoNothing();

    return NextResponse.json({ ok: true, executionId: execId, count: body.signatures.length });
  } catch (e: any) {
    console.error("[/api/tx/log] failed:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "server_error" }, { status: 500 });
  }
}
