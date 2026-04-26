/**
 * Phase 7B — CRUD for tx_category_rules.
 * Owner-scoped to caller's wallet. GET lists, POST creates.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { txCategoryRules } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RuleBody = z.object({
    name: z.string().min(1).max(120),
    matchProgramId: z.string().nullish(),
    matchSource: z.string().nullish(),
    matchCounterparty: z.string().nullish(),
    matchTokenMint: z.string().nullish(),
    matchMemoContains: z.string().nullish(),
    matchMinAmount: z.union([z.string(), z.number()]).nullish(),
    matchMaxAmount: z.union([z.string(), z.number()]).nullish(),
    matchDirection: z.enum(["in", "out", "internal", "any"]).nullish(),
    category: z.string().min(1).max(40),
    tags: z.array(z.string()).default([]),
    priority: z.number().int().min(0).max(10000).default(100),
    enabled: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "db not configured" }, { status: 503 });

    const rows = await db
        .select()
        .from(txCategoryRules)
        .where(eq(txCategoryRules.ownerWallet, user.walletAddress))
        .orderBy(desc(txCategoryRules.priority));
    return NextResponse.json({ ok: true, items: rows });
}

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!db) return NextResponse.json({ error: "db not configured" }, { status: 503 });

    const parsed = RuleBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const d = parsed.data;
    const [row] = await db
        .insert(txCategoryRules)
        .values({
            ownerWallet: user.walletAddress,
            name: d.name,
            matchProgramId: d.matchProgramId ?? null,
            matchSource: d.matchSource ?? null,
            matchCounterparty: d.matchCounterparty ?? null,
            matchTokenMint: d.matchTokenMint ?? null,
            matchMemoContains: d.matchMemoContains ?? null,
            matchMinAmount: d.matchMinAmount != null ? String(d.matchMinAmount) : null,
            matchMaxAmount: d.matchMaxAmount != null ? String(d.matchMaxAmount) : null,
            matchDirection: d.matchDirection ?? null,
            category: d.category,
            tags: d.tags,
            priority: d.priority,
            enabled: d.enabled,
        })
        .returning();
    return NextResponse.json({ ok: true, item: row });
}
