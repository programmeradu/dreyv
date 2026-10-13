/**
 * Canonical site URL for metadata, sitemaps, JSON-LD, OG tags, and protocol manifests.
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

/**
 * Returns canonical public origin for API/MCP responses, avoiding internal 0.0.0.0:8080 Docker container host leakage.
 */
export function getRequestOrigin(req?: Request): string {
  if (req) {
    const fHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
    if (fHost && !fHost.includes("0.0.0.0") && !fHost.includes("127.0.0.1") && !fHost.includes("localhost")) {
      // Public hosts are always served over TLS. The container proxy forwards plain http
      // internally, so never trust x-forwarded-proto here: discovery URLs must be https.
      return `https://${fHost}`;
    }
  }
  return getSiteOrigin();
}

/** Extra Organization.sameAs URLs (GitHub, X, LinkedIn, etc.): comma- or newline-separated. */
export function getOrgSameAsFromEnv(): string[] {
  const raw = process.env.NEXT_PUBLIC_ORG_SAME_AS;
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}
