/**
 * Cloudflare R2 object storage wrapper (S3-compatible REST via account API).
 *
 * Note: For high-throughput data-plane operations, prefer the S3 SDK pointed at
 * the R2 endpoint. This wrapper covers the control-plane + simple put/get/list
 * use cases that Dreyv agents need (artifact storage, snapshots, exports).
 */

import { resolveConfig, authHeaders, cfFetch, accountUrl, type CFConfig } from "./_internal";

export interface R2Target {
  bucket: string;
  config?: Partial<CFConfig>;
}

export interface R2PutOptions extends R2Target {
  key: string;
  body: string | ArrayBuffer | Uint8Array;
  contentType?: string;
}

export interface R2GetOptions extends R2Target {
  key: string;
  expect?: "text" | "arrayBuffer";
}

export interface R2ListOptions extends R2Target {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

function r2Object(cfg: CFConfig, bucket: string, key: string) {
  return accountUrl(cfg, `/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`);
}

function r2Bucket(cfg: CFConfig, bucket: string, path = "") {
  return accountUrl(cfg, `/r2/buckets/${bucket}${path}`);
}

export async function put(opts: R2PutOptions): Promise<{ success: boolean }> {
  const cfg = resolveConfig(opts.config);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiToken}`,
    "Content-Type": opts.contentType ?? "application/octet-stream",
  };
  return cfFetch<{ success: boolean }>(r2Object(cfg, opts.bucket, opts.key), {
    method: "PUT",
    headers,
    body: typeof opts.body === "string" ? opts.body : (opts.body as BodyInit),
  });
}

export async function get(opts: R2GetOptions): Promise<string | ArrayBuffer | null> {
  const cfg = resolveConfig(opts.config);
  try {
    return await cfFetch<string | ArrayBuffer>(
      r2Object(cfg, opts.bucket, opts.key),
      { method: "GET", headers: { Authorization: `Bearer ${cfg.apiToken}` } },
      { expect: opts.expect ?? "text" }
    );
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function del(opts: { bucket: string; key: string; config?: Partial<CFConfig> }) {
  const cfg = resolveConfig(opts.config);
  return cfFetch<{ success: boolean }>(r2Object(cfg, opts.bucket, opts.key), {
    method: "DELETE",
    headers: authHeaders(cfg),
  });
}

export async function list(opts: R2ListOptions): Promise<{
  objects: Array<{ key: string; size: number; etag?: string; uploaded?: string }>;
  cursor?: string;
}> {
  const cfg = resolveConfig(opts.config);
  const params = new URLSearchParams();
  if (opts.prefix) params.set("prefix", opts.prefix);
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.limit) params.set("per_page", String(opts.limit));
  const qs = params.toString();
  const url = r2Bucket(cfg, opts.bucket, `/objects${qs ? `?${qs}` : ""}`);
  const res = await cfFetch<any>(url, { method: "GET", headers: authHeaders(cfg) });
  return {
    objects: res?.result ?? [],
    cursor: res?.result_info?.cursor,
  };
}

export const r2 = { put, get, del, list };
