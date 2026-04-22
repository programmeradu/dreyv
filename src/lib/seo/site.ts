/**
 * Canonical site URL for metadata, sitemaps, JSON-LD, and OG tags.
 *
 * IMPORTANT: Always returns the canonical production host (dreyv.com) —
 * never a Vercel preview URL or alternate domain — so sitemaps, robots,
 * canonical link tags, and JSON-LD all consolidate SEO signals on one
 * host. Middleware 308-redirects dreyv.app / dreyv.finance / www.* here.
 *
 * Do NOT fall back to VERCEL_URL — it changes per deployment and pollutes
 * canonical URLs. Override only via explicit NEXT_PUBLIC_APP_URL when you
 * genuinely need a different canonical (e.g. a fork on a separate domain).
 */
export const DEFAULT_SITE_URL = "https://dreyv.com";

export function getSiteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return new URL(DEFAULT_SITE_URL);
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

export function getSiteOrigin(): string {
  return getSiteUrl().origin;
}

/** Extra Organization.sameAs URLs (GitHub, X, LinkedIn, etc.) — comma- or newline-separated. */
export function getOrgSameAsFromEnv(): string[] {
  const raw = process.env.NEXT_PUBLIC_ORG_SAME_AS;
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}
