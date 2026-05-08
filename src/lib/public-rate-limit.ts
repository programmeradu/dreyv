/**
 * Lightweight in-memory IP rate limiter for unauthenticated public endpoints
 * (e.g. /v/[address] preview surface). Kept intentionally simple — single
 * fixed window per (key, bucket). Process-local; OK for soft abuse mitigation
 * since the upstream APIs (Helius, Marinade, Sanctum) already cache results
 * and the worst-case burst impact is bounded.
 *
 * For hard guarantees use the DB-backed tier rate limiter in
 * src/lib/rate-limiter.ts. This module deliberately has no DB dep so it can
 * gate routes that run on edge / cold-start without paying for a DB roundtrip.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const BUCKETS = new Map<string, Bucket>();

export interface PublicRateLimitOptions {
  /** Bucket name — distinct per resource so different routes don't share counters. */
  bucket: string;
  /** Max requests per IP per windowMs. Default 60. */
  max?: number;
  /** Window size in ms. Default 60_000 (1 minute). */
  windowMs?: number;
}

export interface PublicRateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

function readClientIp(req: Request | { headers: Headers }): string {
  const h = (req as { headers: Headers }).headers;
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip") || h.get("cf-connecting-ip") || "anon";
}

export function checkPublicRateLimit(
  req: Request | { headers: Headers },
  opts: PublicRateLimitOptions,
): PublicRateLimitResult {
  const max = opts.max ?? 60;
  const windowMs = opts.windowMs ?? 60_000;
  const ip = readClientIp(req);
  const key = `${opts.bucket}:${ip}`;
  const now = Date.now();

  let bucket = BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    BUCKETS.set(key, bucket);
  }

  bucket.count += 1;
  const allowed = bucket.count <= max;
  return {
    allowed,
    remaining: Math.max(0, max - bucket.count),
    limit: max,
    resetAt: bucket.resetAt,
  };
}

/**
 * Convenience: returns a 429 Response if the request is over the limit. Caller
 * should `return` the response when not null.
 */
export function publicRateLimitOrResponse(
  req: Request | { headers: Headers },
  opts: PublicRateLimitOptions,
): Response | null {
  const result = checkPublicRateLimit(req, opts);
  if (result.allowed) return null;
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: `Rate limit exceeded for public endpoint. Resets at ${new Date(
        result.resetAt,
      ).toISOString()}.`,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(result.resetAt),
      },
    },
  );
}
