/**
 * DELETE /api/keys/:id — revoke (hard-delete) a key the caller owns.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { publicApiKeys } from "@/db/schema";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!key.scopes.includes("agent:delegate")) {
    return NextResponse.json(
      { error: "insufficient_scope", required: ["agent:delegate"] },
      { status: 403 },
    );
  }
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });

  const result = await db
    .delete(publicApiKeys)
    .where(and(eq(publicApiKeys.id, id), eq(publicApiKeys.userId, key.userId)))
    .returning({ id: publicApiKeys.id });

  if (result.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, id });
}
