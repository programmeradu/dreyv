/**
 * Lightweight per-user/provider rate limiter (in-memory).
 * Good enough for single-instance dev/staging; swap for Redis in prod.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function checkRate(
  userId: string,
  provider: string,
  limit = 120,
  windowMs = 60_000
): { allowed: boolean; remaining: number; resetAt: number } {
  const key = `${userId}:${provider}`;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt < now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, bucket);
    return { allowed: true, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}
