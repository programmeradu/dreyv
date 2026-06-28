const PRODUCTION_PHANTOM_REDIRECT_URL = "https://dreyv.com/auth/callback";

function readPublicEnv(name: string): string | undefined {
  const processValue =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined>)[name]
      : undefined;
  const viteValue = (import.meta as any)?.env?.[name];
  const value = processValue || viteValue;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function getPhantomRedirectUrl(): string {
  const explicitRedirect = readPublicEnv("NEXT_PUBLIC_PHANTOM_REDIRECT_URL");
  if (explicitRedirect) return explicitRedirect.replace(/\/$/, "");

  // Phantom validates redirect_uri with an exact string match. In production,
  // always send the canonical dreyv.com callback instead of whatever hostname
  // the browser happens to be on (www, preview domains, alternate domains).
  if (typeof window === "undefined") return PRODUCTION_PHANTOM_REDIRECT_URL;

  if (isLocalHost(window.location.hostname)) {
    return `${window.location.origin}/auth/callback`;
  }

  return PRODUCTION_PHANTOM_REDIRECT_URL;
}

export function getPhantomPortalOrigin(): string {
  return new URL(getPhantomRedirectUrl()).origin;
}