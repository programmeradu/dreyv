export const runtime = "edge";
/**
 * Phase 7B — Update / delete a single category rule. Owner-scoped.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { txCategoryRules } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
    name: z.string().min(1).max(120).optional(),
    matchProgramId: z.string().nullish(),
    matchSource: z.string().nullish(),
    matchCounterparty: z.string().nullish(),
    matchTokenMint: z.string().nullish(),
    matchMemoContains: z.string().nullish(),
    matchMinAmount: z.union([z.string(), z.number()]).nullish(),
    matchMaxAmount: z.union([z.string(), z.number()]).nullish(),
    matchDirection: z.enum(["in", "out", "internal", "any"]).nullish(),
    category: z.string().min(1).max(40).optional(),
    tags: z.array(z.string()).optional(),
    priority: z.number().int().min(0).max(10000).optional(),
    enabled: z.boolean().optional(),
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
    const d = parsed.data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of Object.keys(d) as (keyof typeof d)[]) {
        if (d[k] !== undefined) {
            if (k === "matchMinAmount" || k === "matchMaxAmount") {
                patch[k] = d[k] == null ? null : String(d[k]);
            } else {
                patch[k] = d[k];
            }
        }
    }
    const [row] = await db
        .update(txCategoryRules)
        .set(patch)
        .where(and(eq(txCategoryRules.id, id), eq(txCategoryRules.ownerWallet, user.walletAddress)))
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
        .delete(txCategoryRules)
        .where(and(eq(txCategoryRules.id, id), eq(txCategoryRules.ownerWallet, user.walletAddress)))
        .returning();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
}
