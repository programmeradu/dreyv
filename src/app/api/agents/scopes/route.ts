export const runtime = "edge";
/**
 * PATCH /api/agents/scopes — agent updates the scopes on its own dk_live_ key.
 *
 *   Authorization: Bearer dk_live_…
 *   Body: { scopes: string[] }            // full replacement, validated against ALL_SCOPES
 *
 * Returns: { ok, key_id, scopes, rejected }
 *
 * Notes:
 *   - This rewrites the scope set of the SAME key the bearer resolves to.
 *     There is no privilege escalation surface: scopes only restrict what
 *     this key can do across capabilities the owning user is already
 *     entitled to. The agent owns the key, so it may widen or narrow it.
 *   - OAuth-issued JWT bearers cannot be edited here (their scopes are
 *     baked into the token); only persisted dk_live_/dk_test_ keys.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { publicApiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  ALL_SCOPES,
  extractBearer,
  resolvePublicKey,
  type ApiScope,
} from "@/lib/api-keys/public-keys";

export const dynamic = "force-dynamic";

const VALID = new Set<string>(ALL_SCOPES as readonly string[]);

export async function PATCH(req: NextRequest) {
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const key = await resolvePublicKey(extractBearer(req));
  if (!key) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message:
          "Missing or invalid Dreyv API key. Pass `Authorization: Bearer dk_live_…`.",
      },
      { status: 401 },
    );
  }
  if (key.keyPrefix === "oauth_jwt") {
    return NextResponse.json(
      {
        error: "unsupported_bearer",
        message:
          "Scopes on OAuth access tokens are immutable — re-request the token with the new scopes instead.",
      },
      { status: 400 },
    );
  }

  let body: { scopes?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  if (!Array.isArray(body.scopes)) {
    return NextResponse.json(
      {
        error: "invalid_input",
        message: "Body must be { scopes: string[] } — provide the full replacement scope set.",
        allowed_scopes: ALL_SCOPES,
      },
      { status: 400 },
    );
  }

  const requested = body.scopes
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const s of requested) {
    if (VALID.has(s)) accepted.push(s);
    else rejected.push(s);
  }
  if (accepted.length === 0) {
    return NextResponse.json(
      {
        error: "no_valid_scopes",
        message: "None of the requested scopes are valid.",
        rejected,
        allowed_scopes: ALL_SCOPES,
      },
      { status: 400 },
    );
  }

  // Dedupe + persist.
  const dedup = Array.from(new Set(accepted));
  await db
    .update(publicApiKeys)
    .set({ scopes: dedup.join(",") })
    .where(eq(publicApiKeys.id, key.id));

  return NextResponse.json({
    ok: true,
    key_id: key.id,
    scopes: dedup as ApiScope[],
    rejected,
    notice:
      rejected.length > 0
        ? `${rejected.length} scope(s) were rejected as unknown. See allowed_scopes.`
        : undefined,
    allowed_scopes: rejected.length > 0 ? ALL_SCOPES : undefined,
  });
}

export async function GET(req: NextRequest) {
  const key = await resolvePublicKey(extractBearer(req));
  if (!key) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    key_id: key.id,
    label: key.label,
    env: key.env,
    scopes: key.scopes,
    rate_limit_rpm: key.rateLimitRpm,
    allowed_scopes: ALL_SCOPES,
  });
}
