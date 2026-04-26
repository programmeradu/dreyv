/**
 * Phase 7B — CRUD for tx_watched_wallets.
 *
 * GET   → list watches owned by the caller (+ auto/vault watches in their org)
 * POST  → add a wallet to watch (source = "user")
 *
 * Auth: SIWS session cookie. Each watch is scoped by `ownerWallet` = caller.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { txWatchedWallets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBody = z.object({
    walletAddress: z.string().min(20).max(64),
    label: z.string().max(120).optional(),
});

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "db not configured" }, { status: 503 });

    const rows = await db
        .select()
        .from(txWatchedWallets)
        .where(eq(txWatchedWallets.ownerWallet, user.walletAddress));
    return NextResponse.json({ ok: true, items: rows });
}

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "db not configured" }, { status: 503 });

    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const { walletAddress, label } = parsed.data;

    try {
        const [row] = await db
            .insert(txWatchedWallets)
            .values({
                walletAddress,
                ownerWallet: user.walletAddress,
                source: "user",
                label: label ?? null,
                active: true,
            })
            .returning();
        return NextResponse.json({ ok: true, item: row });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
