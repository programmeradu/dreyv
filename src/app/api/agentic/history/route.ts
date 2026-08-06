export const dynamic = 'force-dynamic';
export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agentExecutions } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * GET /api/agentic/history?userPublicKey=...&limit=20&offset=0
 * Real execution history from agent_executions, scoped to the caller's wallet.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userPublicKey = searchParams.get("userPublicKey");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);

    if (!userPublicKey) {
      return NextResponse.json({ error: "Missing userPublicKey parameter" }, { status: 400 });
    }
    if (!db) {
      return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
    }

    const where = eq(agentExecutions.walletAddress, userPublicKey);

    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentExecutions)
      .where(where);

    const rows = await db
      .select({
        executionId: agentExecutions.id,
        strategy: agentExecutions.strategy,
        status: agentExecutions.status,
        progress: agentExecutions.progress,
        input: agentExecutions.input,
        result: agentExecutions.result,
        error: agentExecutions.error,
        transactionSignature: agentExecutions.transactionSignature,
        createdAt: agentExecutions.createdAt,
        startedAt: agentExecutions.startedAt,
        completedAt: agentExecutions.completedAt,
        durationMs: agentExecutions.duration,
      })
      .from(agentExecutions)
      .where(where)
      .orderBy(desc(agentExecutions.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json(
      {
        userPublicKey,
        total: countRow?.n ?? 0,
        limit,
        offset,
        executions: rows,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[agentic/history] Error:", error);
    return NextResponse.json(
      { error: error?.message || "History retrieval failed" },
      { status: 500 },
    );
  }
}
