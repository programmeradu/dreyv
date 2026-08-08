/**
 * DELETE /api/agent/keys/[id] — hard-delete an agent API key.
 * Revoked keys are gone from the ledger to keep the settings view quiet.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentApiKeys } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";


export async function DELETE(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

    const result = await db
        .delete(agentApiKeys)
        .where(and(eq(agentApiKeys.id, id), eq(agentApiKeys.userId, user.id)))
        .returning({ id: agentApiKeys.id });

    if (!result.length) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: result[0].id });
}
