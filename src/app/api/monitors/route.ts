export const runtime = "edge";
/**
 * POST /api/monitors — create a price/balance/apy monitor for a wallet.
 * Used by onboarding seed flow and the inbox watcher form.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { monitors } from "@/db/schema";
import { getAuthUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

const Body = z.object({
  walletAddress: z.string().min(32),
  type: z.enum(["price", "balance", "apy", "risk"]),
  target: z.string().min(1),
  operator: z.enum(["above", "below", "equals", "changes"]),
  conditionValue: z.number(),
  active: z.boolean().optional().default(true),
  label: z.string().optional(),
});

export async function POST(req: NextRequest) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const v = parsed.data;
  const [row] = await db
    .insert(monitors)
    .values({
      walletAddress: v.walletAddress,
      type: v.type,
      target: v.target,
      operator: v.operator,
      conditionValue: String(v.conditionValue),
      active: v.active,
    })
    .returning({ id: monitors.id });
  return NextResponse.json({ ok: true, id: row.id });
}
