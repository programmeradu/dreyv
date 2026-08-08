/**
 * GET /api/agent/deliverables/[id]
 *   Returns the full deliverable record + joined agent-key label and tx hash.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { agentApiKeys, agentDeliverables, agentPayments } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

    const [row] = await db
        .select({
            id: agentDeliverables.id,
            kind: agentDeliverables.kind,
            sku: agentDeliverables.sku,
            targetWallet: agentDeliverables.targetWallet,
            status: agentDeliverables.status,
            summary: agentDeliverables.summary,
            payload: agentDeliverables.payload,
            pdfUrl: agentDeliverables.pdfUrl,
            emailTo: agentDeliverables.emailTo,
            emailSentAt: agentDeliverables.emailSentAt,
            emailError: agentDeliverables.emailError,
            error: agentDeliverables.error,
            createdAt: agentDeliverables.createdAt,
            readyAt: agentDeliverables.readyAt,
            agentKeyLabel: agentApiKeys.label,
            agentKeyPrefix: agentApiKeys.keyPrefix,
            amountUsd: agentPayments.amountUsd,
            txSignature: agentPayments.txSignature,
            paidAt: agentPayments.paidAt,
        })
        .from(agentDeliverables)
        .leftJoin(agentApiKeys, eq(agentDeliverables.apiKeyId, agentApiKeys.id))
        .leftJoin(agentPayments, eq(agentDeliverables.paymentId, agentPayments.id))
        .where(and(eq(agentDeliverables.id, id), eq(agentDeliverables.userId, user.id)))
        .limit(1);

    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    return NextResponse.json({ deliverable: row });
}
