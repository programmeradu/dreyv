/**
 * POST /api/keys/:id/rotate — atomically revoke and re-issue, preserving
 * label / scopes / rpm. Returns the new full key ONCE.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { publicApiKeys } from "@/db/schema";
import {
  extractBearer,
  mintPublicKey,
  resolvePublicKey,
  type ApiKeyEnv,
  type ApiScope,
} from "@/lib/api-keys/public-keys";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const [row] = await db
    .select()
    .from(publicApiKeys)
    .where(and(eq(publicApiKeys.id, id), eq(publicApiKeys.userId, key.userId)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const minted = await mintPublicKey({
    userId: key.userId,
    label: row.label,
    env: (row.env as ApiKeyEnv) ?? "live",
    scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean) as ApiScope[],
    rateLimitRpm: row.rateLimitRpm ?? 120,
  });

  await db.delete(publicApiKeys).where(eq(publicApiKeys.id, id));

  return NextResponse.json({
    key: minted,
    notice: "Old key revoked. Store this new key — Dreyv only ever displays it once.",
  });
}
