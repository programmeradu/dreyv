/**
 * Server-only Webacy (DD.xyz) HTTP client.
 *
 * Never called from the browser. All app calls go through the
 * `/api/webacy/*` proxy routes, which use this module.
 *
 * Failure semantics: this client never throws to callers. It always
 * returns a discriminated `{ ok: true, data } | { ok: false, reason }`
 * so upstream code can degrade gracefully (fail-open on read paths;
 * only the Firewall policy fails-closed on `high` risk).
 */

import "server-only";

const BASE_URL = process.env.WEBACY_BASE_URL ?? "https://api.webacy.com";
const TIMEOUT_MS = 8_000;

export type WebacyResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unauthorized" | "not_found" | "rate_limited" | "network" | "server" | "disabled"; status?: number; message?: string };

export function isWebacyEnabled(): boolean {
  if (process.env.WEBACY_ENABLED === "false") return false;
  return Boolean(process.env.WEBACY_API_KEY);
}

async function fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function webacyFetch<T = unknown>(
  path: string,
  opts: { method?: "GET" | "POST"; query?: Record<string, string | number | undefined>; body?: unknown } = {}
): Promise<WebacyResult<T>> {
  if (!isWebacyEnabled()) {
    return { ok: false, reason: "disabled", message: "WEBACY_API_KEY not configured or feature disabled" };
  }

  const apiKey = process.env.WEBACY_API_KEY!;
  const url = new URL(path.startsWith("http") ? path : `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && `${v}` !== "") url.searchParams.set(k, `${v}`);
    }
  }

  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: {
      "x-api-key": apiKey,
      accept: "application/json",
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    // Server-side, force fresh — we cache in-process via cache.ts.
    cache: "no-store",
  };

  let response: Response;
  try {
    response = await fetchOnce(url.toString(), init, TIMEOUT_MS);
    // Single retry on 5xx / network hiccup.
    if (response.status >= 500) {
      response = await fetchOnce(url.toString(), init, TIMEOUT_MS);
    }
  } catch (err) {
    return { ok: false, reason: "network", message: err instanceof Error ? err.message : String(err) };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "unauthorized", status: response.status };
  }
  if (response.status === 404) {
    return { ok: false, reason: "not_found", status: 404 };
  }
  if (response.status === 429) {
    return { ok: false, reason: "rate_limited", status: 429 };
  }
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    return { ok: false, reason: "server", status: response.status, message: message.slice(0, 500) };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: "server", message: err instanceof Error ? err.message : "Invalid JSON" };
  }
}
