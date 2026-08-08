/**
 * GET /api/agent/deliverables
 *   Lists the signed-in user's agent deliverables (most recent first).
 *   Optional ?kind=snapshot|report|subscription and ?limit=N.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { agentApiKeys, agentDeliverables, agentPayments } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

const ALLOWED_KIND = new Set(["snapshot", "report", "subscription"]);

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const kindParam = req.nextUrl.searchParams.get("kind")?.trim();
    const kind = kindParam && ALLOWED_KIND.has(kindParam) ? kindParam : null;
    const limit = Math.max(1, Math.min(200, Number(req.nextUrl.searchParams.get("limit")) || 50));

    const rows = await db
        .select({
            id: agentDeliverables.id,
            kind: agentDeliverables.kind,
            sku: agentDeliverables.sku,
            targetWallet: agentDeliverables.targetWallet,
            status: agentDeliverables.status,
            summary: agentDeliverables.summary,
            pdfUrl: agentDeliverables.pdfUrl,
            emailTo: agentDeliverables.emailTo,
            emailSentAt: agentDeliverables.emailSentAt,
            emailError: agentDeliverables.emailError,
            error: agentDeliverables.error,
            createdAt: agentDeliverables.createdAt,
            readyAt: agentDeliverables.readyAt,
            agentKeyLabel: agentApiKeys.label,
            amountUsd: agentPayments.amountUsd,
            txSignature: agentPayments.txSignature,
        })
        .from(agentDeliverables)
        .leftJoin(agentApiKeys, eq(agentDeliverables.apiKeyId, agentApiKeys.id))
        .leftJoin(agentPayments, eq(agentDeliverables.paymentId, agentPayments.id))
        .where(
            kind
                ? and(eq(agentDeliverables.userId, user.id), eq(agentDeliverables.kind, kind))
                : eq(agentDeliverables.userId, user.id),
        )
        .orderBy(desc(agentDeliverables.createdAt))
        .limit(limit);

    return NextResponse.json({ deliverables: rows });
}
