/**
 * Public Dreyv API keys (dk_live_… / dk_test_…).
 *
 * - Generated, hashed (sha-256) and stored in `public_api_keys`.
 * - Presented as `Authorization: Bearer dk_live_…` on /api/v1/* and /api/mcp.
 * - Scoped: read:portfolio, read:treasury, read:market, read:forensics,
 *   write:simulate, write:intent, pay:x402, agent:delegate.
 * - Per-key rate limit (rpm) enforced in-memory with a sliding window.
 *
 * Distinct from `agent_api_keys` (dak_…) which are payment-only and
 * untouched by this module.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { publicApiKeys, publicApiKeyUsage } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ApiKeyEnv = "live" | "test";

export const ALL_SCOPES = [
  "read:portfolio",
  "read:treasury",
  "read:market",
  "read:forensics",
  "read:notifications",
  "write:simulate",
  "write:intent",
  "write:trade",
  "write:watchers",
  "pay:x402",
  "agent:delegate",
] as const;
export type ApiScope = (typeof ALL_SCOPES)[number];

export const DEFAULT_SCOPES: ApiScope[] = [
  "read:portfolio",
  "read:treasury",
  "read:market",
];

export interface MintedPublicKey {
  id: string;
  label: string;
  env: ApiKeyEnv;
  fullKey: string;        // returned ONCE
  keyPrefix: string;
  scopes: ApiScope[];
  rateLimitRpm: number;
  createdAt: Date;
}

export interface ResolvedPublicKey {
  id: string;
  userId: string;
  label: string;
  env: ApiKeyEnv;
  keyPrefix: string;
  scopes: ApiScope[];
  rateLimitRpm: number;
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function prefixFor(env: ApiKeyEnv): string {
  return env === "test" ? "dk_test_" : "dk_live_";
}

export async function mintPublicKey(args: {
  userId: string;
  label: string;
  env?: ApiKeyEnv;
  scopes?: ApiScope[];
  rateLimitRpm?: number;
}): Promise<MintedPublicKey> {
  if (!db) throw new Error("Database unavailable");
  const env = args.env ?? "live";
  const label = args.label.trim().slice(0, 80) || "Untitled key";
  const scopes = (args.scopes ?? DEFAULT_SCOPES).filter((s) =>
    (ALL_SCOPES as readonly string[]).includes(s),
  ) as ApiScope[];
  const rateLimitRpm = Math.max(10, Math.min(args.rateLimitRpm ?? 120, 6000));

  const random = randomBytes(28).toString("base64url");
  const fullKey = `${prefixFor(env)}${random}`;
  const keyHash = hashKey(fullKey);
  const keyPrefix = fullKey.slice(0, 16);

  const [row] = await db
    .insert(publicApiKeys)
    .values({
      userId: args.userId,
      label,
      env,
      keyPrefix,
      keyHash,
      scopes: scopes.join(","),
      rateLimitRpm,
    })
    .returning({ id: publicApiKeys.id, createdAt: publicApiKeys.createdAt });

  return {
    id: row.id,
    label,
    env,
    fullKey,
    keyPrefix,
    scopes,
    rateLimitRpm,
    createdAt: row.createdAt,
  };
}

export async function resolvePublicKey(
  bearer: string | null | undefined,
): Promise<ResolvedPublicKey | null> {
  if (!bearer) return null;
  if (!bearer.startsWith("dk_live_") && !bearer.startsWith("dk_test_")) return null;
  if (!db) return null;

  const expectedHash = hashKey(bearer);
  const [row] = await db
    .select()
    .from(publicApiKeys)
    .where(eq(publicApiKeys.keyHash, expectedHash))
    .limit(1);

  if (!row || row.revokedAt) return null;

  try {
    const a = Buffer.from(expectedHash, "hex");
    const b = Buffer.from(row.keyHash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  // fire-and-forget last_used bump
  void db
    .update(publicApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(publicApiKeys.id, row.id))
    .catch(() => undefined);

  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    env: (row.env as ApiKeyEnv) ?? "live",
    keyPrefix: row.keyPrefix,
    scopes: (row.scopes as string).split(",").map((s: string) => s.trim()).filter(Boolean) as ApiScope[],
    rateLimitRpm: row.rateLimitRpm ?? 120,
  };
}

export function hasScope(key: ResolvedPublicKey, scope: ApiScope): boolean {
  return key.scopes.includes(scope);
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

// ─────────────────────────────────────────────────────────────────────
// Sliding-window in-memory rate limiter (per-key, per-minute).
// Adequate for single-region; replace with Redis when we scale out.
// ─────────────────────────────────────────────────────────────────────
const buckets = new Map<string, number[]>();

export function checkRateLimit(key: ResolvedPublicKey): {
  ok: boolean;
  retryAfterMs: number;
  remaining: number;
} {
  const now = Date.now();
  const windowMs = 60_000;
  const arr = buckets.get(key.id) ?? [];
  // drop timestamps older than window
  while (arr.length > 0 && arr[0] <= now - windowMs) arr.shift();
  if (arr.length >= key.rateLimitRpm) {
    const retryAfterMs = Math.max(0, windowMs - (now - arr[0]));
    buckets.set(key.id, arr);
    return { ok: false, retryAfterMs, remaining: 0 };
  }
  arr.push(now);
  buckets.set(key.id, arr);
  return { ok: true, retryAfterMs: 0, remaining: key.rateLimitRpm - arr.length };
}

export async function recordUsage(args: {
  keyId: string;
  userId: string;
  capabilityId: string;
  transport: "rest" | "mcp";
  status: "ok" | "error" | "denied" | "rate_limited";
  latencyMs: number;
  costCredits?: number;
  errorCode?: string;
}): Promise<void> {
  if (!db) return;
  try {
    await db.insert(publicApiKeyUsage).values({
      keyId: args.keyId,
      userId: args.userId,
      capabilityId: args.capabilityId,
      transport: args.transport,
      status: args.status,
      latencyMs: args.latencyMs,
      costCredits: (args.costCredits ?? 0).toFixed(4),
      errorCode: args.errorCode ?? null,
    });
  } catch {
    // metering is best-effort
  }
}
