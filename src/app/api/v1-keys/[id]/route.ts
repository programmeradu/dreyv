/**
 * DELETE /api/v1-keys/:id — revoke a public API key.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { publicApiKeys } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  const { id } = await ctx.params;

  const result = await db
    .update(publicApiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(publicApiKeys.id, id), eq(publicApiKeys.userId, user.id)))
    .returning({ id: publicApiKeys.id });

  if (result.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, id });
}
