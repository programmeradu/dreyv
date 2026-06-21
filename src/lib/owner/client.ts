/**
 * Tiny client helper for /api/owner/run. Returns `data` or throws
 * with the server error code so React Query / try-catch reads cleanly.
 */
export async function runCapability<T = unknown>(
  capability: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch("/api/owner/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ capability, input }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: T;
    error?: string;
    issues?: unknown;
  };
  if (!res.ok || !body.ok) {
    const e = new Error(body.error ?? `http_${res.status}`);
    (e as Error & { issues?: unknown }).issues = body.issues;
    throw e;
  }
  return body.data as T;
}
