/**
 * Cloudflare Browser Rendering REST wrapper.
 *
 * Mirrors the legacy `src/lib/cloudflare/cf-browser.ts` surface but with:
 *   - explicit config injection (no hidden env coupling)
 *   - typed responses
 *   - shared retry/backoff via _internal.cfFetch
 */

import { resolveConfig, authHeaders, cfFetch, accountUrl, type CFConfig } from "./_internal";

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

export interface BrowserBaseOptions {
  url?: string;
  html?: string;
  viewport?: { width: number; height: number };
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  config?: Partial<CFConfig>;
}

export interface ScreenshotOptions extends BrowserBaseOptions {
  fullPage?: boolean;
  screenshotOptions?: Record<string, unknown>;
}

export interface PdfOptions extends BrowserBaseOptions {
  pdfOptions?: Record<string, unknown>;
}

export interface MarkdownOptions extends BrowserBaseOptions {}

export interface ScrapeOptions extends BrowserBaseOptions {
  elements: Array<{ selector: string }>;
}

export interface LinksOptions extends BrowserBaseOptions {
  visibleLinksOnly?: boolean;
}

export interface JsonExtractOptions extends BrowserBaseOptions {
  prompt: string;
  responseFormat?: Record<string, unknown>;
}

function endpoint(cfg: CFConfig, action: string) {
  return accountUrl(cfg, `/browser-rendering/${action}`);
}

function bodyFor(opts: BrowserBaseOptions, extra: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = {
    viewport: opts.viewport ?? DEFAULT_VIEWPORT,
    ...extra,
  };
  if (opts.url) body.url = opts.url;
  if (opts.html) body.html = opts.html;
  if (opts.waitUntil) body.gotoOptions = { waitUntil: opts.waitUntil };
  return body;
}

export async function screenshot(opts: ScreenshotOptions): Promise<ArrayBuffer> {
  const cfg = resolveConfig(opts.config);
  return cfFetch<ArrayBuffer>(
    endpoint(cfg, "screenshot"),
    {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify(
        bodyFor(opts, {
          screenshotOptions: { fullPage: opts.fullPage ?? false, ...opts.screenshotOptions },
        })
      ),
    },
    { expect: "arrayBuffer" }
  );
}

export async function pdf(opts: PdfOptions): Promise<ArrayBuffer> {
  const cfg = resolveConfig(opts.config);
  return cfFetch<ArrayBuffer>(
    endpoint(cfg, "pdf"),
    {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify(bodyFor(opts, { pdfOptions: opts.pdfOptions ?? {} })),
    },
    { expect: "arrayBuffer" }
  );
}

export async function markdown(opts: MarkdownOptions): Promise<string> {
  const cfg = resolveConfig(opts.config);
  const res = await cfFetch<any>(endpoint(cfg, "markdown"), {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(bodyFor(opts)),
  });
  return res?.result ?? res?.markdown ?? (typeof res === "string" ? res : "");
}

export async function snapshot(opts: BrowserBaseOptions): Promise<string> {
  const cfg = resolveConfig(opts.config);
  const res = await cfFetch<any>(endpoint(cfg, "snapshot"), {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(bodyFor(opts)),
  });
  return res?.result?.content ?? res?.result ?? "";
}

export async function scrape(opts: ScrapeOptions): Promise<unknown> {
  const cfg = resolveConfig(opts.config);
  return cfFetch(endpoint(cfg, "scrape"), {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(bodyFor(opts, { elements: opts.elements })),
  });
}

export async function links(opts: LinksOptions): Promise<unknown> {
  const cfg = resolveConfig(opts.config);
  return cfFetch(endpoint(cfg, "links"), {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(bodyFor(opts, { visibleLinksOnly: opts.visibleLinksOnly ?? false })),
  });
}

export async function jsonExtract(opts: JsonExtractOptions): Promise<unknown> {
  const cfg = resolveConfig(opts.config);
  return cfFetch(endpoint(cfg, "json"), {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(
      bodyFor(opts, { prompt: opts.prompt, response_format: opts.responseFormat })
    ),
  });
}

// ───── Multi-page crawl ────────────────────────────────────────────────
export interface CrawlStartOptions extends BrowserBaseOptions {
  url: string;
  limit?: number;
  depth?: number;
  format?: "html" | "markdown" | "json";
  includePatterns?: string[];
  excludePatterns?: string[];
  render?: boolean;
}

export async function startCrawl(opts: CrawlStartOptions): Promise<{ jobId: string }> {
  const cfg = resolveConfig(opts.config);
  const res = await cfFetch<any>(endpoint(cfg, "crawl"), {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify({
      url: opts.url,
      limit: opts.limit ?? 25,
      depth: opts.depth ?? 3,
      format: opts.format ?? "markdown",
      includePatterns: opts.includePatterns,
      excludePatterns: opts.excludePatterns,
      render: opts.render ?? false,
    }),
  });
  return { jobId: res?.result?.jobId ?? res?.jobId };
}

export async function getCrawlStatus(
  jobId: string,
  query: { cursor?: string; limit?: number; status?: string; config?: Partial<CFConfig> } = {}
): Promise<unknown> {
  const cfg = resolveConfig(query.config);
  const params = new URLSearchParams();
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.status) params.set("status", query.status);
  const qs = params.toString();
  const url = endpoint(cfg, `crawl/${jobId}${qs ? `?${qs}` : ""}`);
  return cfFetch(url, { method: "GET", headers: authHeaders(cfg) });
}

export async function cancelCrawl(
  jobId: string,
  config?: Partial<CFConfig>
): Promise<{ success: boolean }> {
  const cfg = resolveConfig(config);
  return cfFetch<{ success: boolean }>(endpoint(cfg, `crawl/${jobId}`), {
    method: "DELETE",
    headers: authHeaders(cfg),
  });
}

// Namespace export (so callers can do `import { browser } from "@dreyv/cloudflare"`)
export const browser = {
  screenshot,
  pdf,
  markdown,
  snapshot,
  scrape,
  links,
  jsonExtract,
  startCrawl,
  getCrawlStatus,
  cancelCrawl,
};
