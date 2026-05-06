import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactionCache, agentExecutions } from "@/db/schema";
import { sql } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";

// CommandBar (and any other client-signed flow) pings this after the wallet
// signs and the RPC accepts the transaction. We persist:
//  1) one transaction_cache row per signature → admin "On-chain & TX volume"
//  2) one agent_executions row per command → admin "AI agent fleet"
// Helius webhook will still backfill the richer fields later (block_time,
// fee, value_usd) — we just claim the row early so the dashboard isn't blank.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LogPayload {
  signatures: string[];
  operation?: string;
  toolName?: string;
  prompt?: string;
  vaultAddress?: string | null;
  estimatedValueUsd?: number | null;
  source?: "commandbar" | "agent" | "manual";
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

    // 1) transaction_cache — one row per signature, idempotent on signature
    const txRows = body.signatures.map((sig) => ({
      userId: user.id,
      walletAddress: user.walletAddress,
      signature: sig,
      success: true,
      type: "program" as const,
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

    // 2) agent_executions — single SUCCESS row per command, references first sig
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
        result: { signatures: body.signatures, valueUsd },
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
