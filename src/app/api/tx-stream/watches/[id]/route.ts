/**
 * Phase 7B — Update / delete a single watched wallet.
 * Owner-scoped: only the caller can mutate their watches.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { txWatchedWallets } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBody = z.object({
    label: z.string().max(120).nullish(),
    active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "db not configured" }, { status: 503 });

    const { id } = await params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const [row] = await db
        .update(txWatchedWallets)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(txWatchedWallets.id, id), eq(txWatchedWallets.ownerWallet, user.walletAddress)))
        .returning();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, item: row });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "db not configured" }, { status: 503 });

    const { id } = await params;
    const [row] = await db
        .delete(txWatchedWallets)
        .where(and(eq(txWatchedWallets.id, id), eq(txWatchedWallets.ownerWallet, user.walletAddress)))
        .returning();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
}
