/**
 * Agent API key management.
 *   GET  /api/agent/keys           — list user's keys (hashes hidden)
 *   POST /api/agent/keys           — mint a new key; full token returned ONCE
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { agentApiKeys } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";
import { mintAgentKey } from "@/lib/agent/api-keys";


export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    const rows = await db
        .select({
            id: agentApiKeys.id,
            label: agentApiKeys.label,
            keyPrefix: agentApiKeys.keyPrefix,
            scopes: agentApiKeys.scopes,
            spendLimitUsd: agentApiKeys.spendLimitUsd,
            spentUsd: agentApiKeys.spentUsd,
            lastUsedAt: agentApiKeys.lastUsedAt,
            revokedAt: agentApiKeys.revokedAt,
            createdAt: agentApiKeys.createdAt,
        })
        .from(agentApiKeys)
        .where(eq(agentApiKeys.userId, user.id))
        .orderBy(desc(agentApiKeys.createdAt))
        .limit(100);

    return NextResponse.json({ keys: rows });
}

const Body = z.object({
    label: z.string().trim().min(1).max(80),
    spendLimitUsd: z.number().positive().max(100_000).optional(),
});

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

    let raw: unknown;
    try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    // Cap at 25 active keys per user to prevent abuse.
    const existing = await db
        .select({ id: agentApiKeys.id })
        .from(agentApiKeys)
        .where(eq(agentApiKeys.userId, user.id))
        .limit(26);
    if (existing.length >= 25) {
        return NextResponse.json(
            { error: "limit_reached", message: "Revoke an unused key before creating a new one (limit: 25)." },
            { status: 409 },
        );
    }

    const minted = await mintAgentKey({
        userId: user.id,
        label: parsed.data.label,
        spendLimitUsd: parsed.data.spendLimitUsd ?? null,
    });

    return NextResponse.json({
        id: minted.id,
        label: minted.label,
        keyPrefix: minted.keyPrefix,
        createdAt: minted.createdAt,
        /** Returned exactly once. The client must store it immediately. */
        secret: minted.fullKey,
    }, { status: 201 });
}
