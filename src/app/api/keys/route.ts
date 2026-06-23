/**
 * /api/keys — programmatic API-key management for agents.
 *
 *   GET   /api/keys           — list this caller's keys (prefix only)
 *   POST  /api/keys           — mint a key (full key returned ONCE)
 *
 * Auth: Bearer (dk_live_… with scope `agent:delegate`, OR OAuth JWT with `mcp`).
 * This is the headless counterpart to /api/v1-keys (cookie-based human UI).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { publicApiKeys } from "@/db/schema";
import {
  extractBearer,
  resolvePublicKey,
  mintPublicKey,
  ALL_SCOPES,
  DEFAULT_SCOPES,
  type ApiScope,
  type ApiKeyEnv,
} from "@/lib/api-keys/public-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function canManageKeys(scopes: string[]): boolean {
  // OAuth tokens get this when they include `mcp` (resolvePublicKey doesn't expand
  // `mcp` to anything, so we accept that token type via a separate signal: the
  // key id starts with "oauth:") — but the cleanest gate is just to require
  // `agent:delegate` on dk_ keys. Agents minted via /api/agents/signup get
  // `agent:delegate` by default so they can rotate themselves.
  return scopes.includes("agent:delegate");
}

export async function GET(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageKeys(key.scopes)) {
    return NextResponse.json(
      { error: "insufficient_scope", required: ["agent:delegate"] },
      { status: 403 },
    );
  }
  if (!db) return NextResponse.json({ keys: [] });

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
    .where(and(eq(publicApiKeys.userId, key.userId), isNotNull(publicApiKeys.createdAt)))
    .orderBy(desc(publicApiKeys.createdAt));

  return NextResponse.json({
    keys: rows.map((r) => ({
      ...r,
      scopes: r.scopes.split(",").map((s) => s.trim()).filter(Boolean),
    })),
  });
}

export async function POST(req: NextRequest) {
  const bearer = extractBearer(req);
  const key = bearer ? await resolvePublicKey(bearer) : null;
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageKeys(key.scopes)) {
    return NextResponse.json(
      { error: "insufficient_scope", required: ["agent:delegate"] },
      { status: 403 },
    );
  }

  let body: {
    label?: string;
    env?: ApiKeyEnv;
    scopes?: ApiScope[];
    rateLimitRpm?: number;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Caller cannot mint a key with broader scope than they already have.
  const requested = (body.scopes ?? DEFAULT_SCOPES).filter((s) =>
    (ALL_SCOPES as readonly string[]).includes(s),
  ) as ApiScope[];
  const allowed = requested.filter((s) => key.scopes.includes(s));
  if (allowed.length === 0) {
    return NextResponse.json(
      { error: "no_overlap", granted: key.scopes },
      { status: 403 },
    );
  }

  const minted = await mintPublicKey({
    userId: key.userId,
    label: body.label ?? "Agent-issued key",
    env: body.env ?? "live",
    scopes: allowed,
    rateLimitRpm: body.rateLimitRpm,
  });

  return NextResponse.json({
    key: minted,
    notice: "Store this key now — Dreyv only ever displays it once.",
  });
}
