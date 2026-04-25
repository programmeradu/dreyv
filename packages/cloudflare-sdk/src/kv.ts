/**
 * Cloudflare KV REST wrapper.
 * Docs: https://developers.cloudflare.com/api/operations/workers-kv-namespace-write-key-value-pair-with-metadata
 */

import { resolveConfig, authHeaders, cfFetch, accountUrl, type CFConfig } from "./_internal";

export interface KVNamespaceTarget {
  namespaceId: string;
  config?: Partial<CFConfig>;
}

export interface KVPutOptions extends KVNamespaceTarget {
  key: string;
  value: string;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface KVGetOptions extends KVNamespaceTarget {
  key: string;
}

export interface KVListOptions extends KVNamespaceTarget {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

function kvBase(cfg: CFConfig, namespaceId: string) {
  return accountUrl(cfg, `/storage/kv/namespaces/${namespaceId}`);
}

export async function put(opts: KVPutOptions): Promise<{ success: boolean }> {
  const cfg = resolveConfig(opts.config);
  const params = new URLSearchParams();
  if (opts.ttlSeconds) params.set("expiration_ttl", String(opts.ttlSeconds));
  const qs = params.toString();
  const url = `${kvBase(cfg, opts.namespaceId)}/values/${encodeURIComponent(opts.key)}${qs ? `?${qs}` : ""}`;

  // KV write supports metadata via multipart form
  if (opts.metadata) {
    const form = new FormData();
    form.set("value", opts.value);
    form.set("metadata", JSON.stringify(opts.metadata));
    return cfFetch<{ success: boolean }>(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${cfg.apiToken}` },
      body: form,
    });
  }
  return cfFetch<{ success: boolean }>(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "text/plain" },
    body: opts.value,
  });
}

export async function get(opts: KVGetOptions): Promise<string | null> {
  const cfg = resolveConfig(opts.config);
  const url = `${kvBase(cfg, opts.namespaceId)}/values/${encodeURIComponent(opts.key)}`;
  try {
    return await cfFetch<string>(
      url,
      { method: "GET", headers: { Authorization: `Bearer ${cfg.apiToken}` } },
      { expect: "text" }
    );
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function del(opts: KVGetOptions): Promise<{ success: boolean }> {
  const cfg = resolveConfig(opts.config);
  const url = `${kvBase(cfg, opts.namespaceId)}/values/${encodeURIComponent(opts.key)}`;
  return cfFetch<{ success: boolean }>(url, {
    method: "DELETE",
    headers: authHeaders(cfg),
  });
}

export async function list(opts: KVListOptions): Promise<{
  keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
  cursor?: string;
}> {
  const cfg = resolveConfig(opts.config);
  const params = new URLSearchParams();
  if (opts.prefix) params.set("prefix", opts.prefix);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  const qs = params.toString();
  const url = `${kvBase(cfg, opts.namespaceId)}/keys${qs ? `?${qs}` : ""}`;
  const res = await cfFetch<any>(url, { method: "GET", headers: authHeaders(cfg) });
  return {
    keys: res?.result ?? [],
    cursor: res?.result_info?.cursor,
  };
}

export const kv = { put, get, del, list };
