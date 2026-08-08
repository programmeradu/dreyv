/**
 * Per-user public Dreyv API key management.
 *
 *   GET  /api/v1-keys           — list this user's keys (prefix only)
 *   POST /api/v1-keys           — mint a key (full key returned ONCE)
 *   DELETE /api/v1-keys/:id     — revoke
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { publicApiKeys } from "@/db/schema";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";
import {
  mintPublicKey,
  ALL_SCOPES,
  DEFAULT_SCOPES,
  type ApiScope,
  type ApiKeyEnv,
} from "@/lib/api-keys/public-keys";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!db) return NextResponse.json({ keys: [] });

  // One-time cleanup: hard-delete any legacy soft-revoked rows for this user
  // so the ledger stays minimal. New revocations are already hard deletes.
  await db
    .delete(publicApiKeys)
    .where(and(eq(publicApiKeys.userId, user.id), isNotNull(publicApiKeys.revokedAt)));

  const rows = await db
    .select({
      id: publicApiKeys.id,
      label: publicApiKeys.label,
      env: publicApiKeys.env,
      keyPrefix: publicApiKeys.keyPrefix,
      scopes: publicApiKeys.scopes,
      rateLimitRpm: publicApiKeys.rateLimitRpm,
      lastUsedAt: publicApiKeys.lastUsedAt,
      revokedAt: publicApiKeys.revokedAt,
      createdAt: publicApiKeys.createdAt,
    })
    .from(publicApiKeys)
    .where(eq(publicApiKeys.userId, user.id))
    .orderBy(desc(publicApiKeys.createdAt));

  return NextResponse.json({
    keys: rows.map((r) => ({
      ...r,
      scopes: r.scopes.split(",").map((s) => s.trim()).filter(Boolean),
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { label?: string; env?: ApiKeyEnv; scopes?: ApiScope[]; rateLimitRpm?: number } = {};
  try { body = await req.json(); } catch { body = {}; }

  const minted = await mintPublicKey({
    userId: user.id,
    label: body.label ?? "Dreyv API key",
    env: body.env ?? "live",
    scopes: (body.scopes ?? DEFAULT_SCOPES).filter((s) => (ALL_SCOPES as readonly string[]).includes(s)) as ApiScope[],
    rateLimitRpm: body.rateLimitRpm,
  });

  return NextResponse.json({
    key: minted,
    notice: "Store this key now — Dreyv only ever displays it once.",
  });
}
