/**
 * Internal helpers shared by every @dreyv/cloudflare module.
 *
 * Centralises:
 *   - config resolution (env or explicit override)
 *   - auth headers
 *   - typed fetch with retry/backoff
 *   - error envelope normalisation
 */

export interface CFConfig {
  accountId: string;
  apiToken: string;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 4000,
};

export function resolveConfig(override?: Partial<CFConfig>): CFConfig {
  const accountId =
    override?.accountId ??
    (typeof process !== "undefined" ? process.env?.CLOUDFLARE_ACCOUNT_ID : undefined);
  const apiToken =
    override?.apiToken ??
    (typeof process !== "undefined" ? process.env?.CLOUDFLARE_AI_TOKEN : undefined);

  if (!accountId || !apiToken) {
    throw new Error(
      "[@dreyv/cloudflare] Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_AI_TOKEN. " +
        "Set them as env vars or pass { accountId, apiToken } explicitly."
    );
  }
  return { accountId, apiToken };
}

export function authHeaders(cfg: CFConfig, extra: Record<string, string> = {}): HeadersInit {
  return {
    Authorization: `Bearer ${cfg.apiToken}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export class CloudflareApiError extends Error {
  constructor(
    public status: number,
    public endpoint: string,
    public body: unknown,
    message?: string
  ) {
    super(message ?? `Cloudflare API ${status} at ${endpoint}`);
    this.name = "CloudflareApiError";
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** fetch with exponential backoff on 429 / 5xx. Throws CloudflareApiError on permanent failure. */
export async function cfFetch<T = unknown>(
  url: string,
  init: RequestInit,
  options: RetryOptions & { expect?: "json" | "text" | "arrayBuffer" } = {}
): Promise<T> {
  const retry = { ...DEFAULT_RETRY, ...options };
  const expect = options.expect ?? "json";
  let lastErr: unknown;

  for (let attempt = 0; attempt < retry.attempts; attempt++) {
    try {
      const res = await fetch(url, init);

      if (res.ok) {
        if (expect === "arrayBuffer") return (await res.arrayBuffer()) as T;
        if (expect === "text") return (await res.text()) as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as T;
        }
      }

      // Retry on rate limit / transient
      if (res.status === 429 || res.status >= 500) {
        const delay = Math.min(
          retry.maxDelayMs,
          retry.baseDelayMs * Math.pow(2, attempt) + Math.random() * 200
        );
        await sleep(delay);
        continue;
      }

      // Permanent failure
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => null);
      }
      throw new CloudflareApiError(res.status, url, body);
    } catch (err) {
      lastErr = err;
      if (err instanceof CloudflareApiError) throw err;
      // network error → backoff
      const delay = Math.min(
        retry.maxDelayMs,
        retry.baseDelayMs * Math.pow(2, attempt) + Math.random() * 200
      );
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("[@dreyv/cloudflare] cfFetch exhausted retries");
}

export function accountUrl(cfg: CFConfig, path: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}${path}`;
}
