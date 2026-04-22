/**
 * Cloudflare Browser Rendering — Shared Client Library.
 *
 * Wraps all CF Browser Rendering REST API endpoints:
 * - screenshot: URL/HTML → PNG/JPEG
 * - pdf: URL/HTML → PDF buffer
 * - json: URL + prompt → structured JSON (AI-powered)
 * - markdown: URL → clean markdown text
 * - snapshot: URL → full rendered HTML snapshot
 * - content: URL → raw HTML
 * - scrape: URL + selectors → extracted elements
 * - links: URL → all links on the page
 *
 * Auth: reuses CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN env vars.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface CFBrowserConfig {
    accountId: string;
    apiToken: string;
}

export interface ScreenshotOptions {
    /** URL to screenshot (provide url OR html, not both) */
    url?: string;
    /** Raw HTML to render and screenshot */
    html?: string;
    /** Viewport width (default: 1920) */
    viewportWidth?: number;
    /** Viewport height (default: 1080) */
    viewportHeight?: number;
    /** Screenshot options */
    screenshotOptions?: {
        type?: "png" | "jpeg" | "webp";
        quality?: number;
        fullPage?: boolean;
        omitBackground?: boolean;
        clip?: { x: number; y: number; width: number; height: number };
    };
    /** CSS selector to screenshot a specific element */
    selector?: string;
    /** Wait for selector before capturing */
    waitForSelector?: string;
    /** Custom CSS to inject */
    addStyleTag?: { content: string }[];
    /** Wait time in ms after page load */
    waitForTimeout?: number;
}

export interface PdfOptions {
    url?: string;
    html?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    pdfOptions?: {
        format?: "A4" | "Letter" | "Legal" | "Tabloid" | "A3" | "A5";
        landscape?: boolean;
        printBackground?: boolean;
        margin?: { top?: string; bottom?: string; left?: string; right?: string };
        headerTemplate?: string;
        footerTemplate?: string;
        displayHeaderFooter?: boolean;
        scale?: number;
    };
    waitForSelector?: string;
    waitForTimeout?: number;
    addStyleTag?: { content: string }[];
}

export interface JsonExtractOptions {
    url?: string;
    html?: string;
    /** Natural language prompt for AI extraction */
    prompt: string;
    /** JSON schema defining expected output structure */
    response_format?: {
        type: "json_schema";
        schema: Record<string, any>;
    };
    waitForSelector?: string;
    waitForTimeout?: number;
}

export interface MarkdownOptions {
    url: string;
    waitForSelector?: string;
    waitForTimeout?: number;
}

export interface SnapshotOptions {
    url: string;
    waitForSelector?: string;
    waitForTimeout?: number;
}

export interface ScrapeOptions {
    url?: string;
    html?: string;
    /** CSS selectors to extract elements */
    elements: { selector: string }[];
    waitForSelector?: string;
    waitForTimeout?: number;
}

export interface LinksOptions {
    url: string;
    waitForSelector?: string;
    waitForTimeout?: number;
}

// ─── Crawl types ────────────────────────────────────────────────────

export type CrawlFormat = "html" | "markdown" | "json";
export type CrawlSource = "all" | "sitemaps" | "links";
export type CrawlPurpose = "search" | "ai-input" | "ai-train";
export type CrawlRecordStatus =
    | "queued"
    | "completed"
    | "disallowed"
    | "skipped"
    | "errored"
    | "cancelled";
export type CrawlJobStatus =
    | "running"
    | "completed"
    | "errored"
    | "cancelled_by_user"
    | "cancelled_due_to_timeout"
    | "cancelled_due_to_limits";

export interface CrawlStartOptions {
    url: string;
    /** Max pages (default 10, max 100,000) */
    limit?: number;
    /** Max link depth (default 100,000, max 100,000) */
    depth?: number;
    /** URL discovery source (default "all") */
    source?: CrawlSource;
    /** Response formats (default ["html"]) */
    formats?: CrawlFormat[];
    /** Execute JS via headless browser (default true). false = fast HTML fetch. */
    render?: boolean;
    jsonOptions?: {
        prompt?: string;
        response_format?: { type: "json_schema"; schema: Record<string, any> };
        custom_ai?: Record<string, any>;
    };
    /** Cache TTL seconds (default 86,400, max 604,800) */
    maxAge?: number;
    /** Unix seconds — only crawl pages modified after this */
    modifiedSince?: number;
    options?: {
        includeExternalLinks?: boolean;
        includeSubdomains?: boolean;
        includePatterns?: string[];
        excludePatterns?: string[];
    };
    /** Declared use of crawled content. Default ["search","ai-input","ai-train"] */
    crawlPurposes?: CrawlPurpose[];
    /** Block resource types (only when render=true) */
    rejectResourceTypes?: string[];
    rejectRequestPattern?: string[];
    cookies?: any[];
    setExtraHTTPHeaders?: Record<string, string>;
    authenticate?: { username: string; password: string };
    gotoOptions?: Record<string, any>;
    waitForSelector?: { selector: string; timeout?: number; visible?: boolean };
}

export interface CrawlStartResponse {
    success: boolean;
    /** Job ID returned by CF */
    result: string;
}

export interface CrawlRecord {
    url: string;
    status: CrawlRecordStatus | number;
    markdown?: string;
    html?: string;
    json?: any;
    metadata?: {
        status?: number;
        title?: string;
        url?: string;
        [k: string]: any;
    };
}

export interface CrawlStatusResult {
    id: string;
    status: CrawlJobStatus;
    browserSecondsUsed?: number;
    total?: number;
    finished?: number;
    records?: CrawlRecord[];
    cursor?: number;
}

export interface CrawlStatusResponse {
    success: boolean;
    result: CrawlStatusResult;
}

export interface CrawlStatusQuery {
    cursor?: number;
    limit?: number;
    status?: CrawlRecordStatus;
}

// ─── Client ─────────────────────────────────────────────────────────

function getConfig(): CFBrowserConfig {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_AI_TOKEN;

    if (!accountId || !apiToken) {
        throw new Error(
            "Cloudflare Browser Rendering not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN."
        );
    }

    return { accountId, apiToken };
}

function baseUrl(config: CFBrowserConfig): string {
    return `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/browser-rendering`;
}

function headers(config: CFBrowserConfig): Record<string, string> {
    return {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
    };
}

async function cfFetch(
    endpoint: string,
    body: Record<string, any>,
    expectBinary = false
): Promise<any> {
    const config = getConfig();
    const url = `${baseUrl(config)}/${endpoint}`;

    const res = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({
            ...body,
            // Set default viewport if not provided
            viewport: body.viewport || {
                width: body.viewportWidth || 1920,
                height: body.viewportHeight || 1080,
            },
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`CF Browser Rendering /${endpoint} error (${res.status}): ${errText.slice(0, 300)}`);
    }

    if (expectBinary) {
        return res.arrayBuffer();
    }

    // Try JSON first, fall back to text
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        return res.json();
    }
    return res.text();
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Capture a screenshot of a URL or rendered HTML.
 * Returns raw image binary (ArrayBuffer).
 */
export async function screenshot(opts: ScreenshotOptions): Promise<ArrayBuffer> {
    const body: Record<string, any> = {};

    if (opts.url) body.url = opts.url;
    if (opts.html) body.html = opts.html;
    if (opts.screenshotOptions) body.screenshotOptions = opts.screenshotOptions;
    if (opts.selector) body.selector = opts.selector;
    if (opts.waitForSelector) body.gotoOptions = { ...body.gotoOptions, waitUntil: "networkidle0" };
    if (opts.waitForTimeout) body.waitForTimeout = opts.waitForTimeout;
    if (opts.addStyleTag) body.addStyleTag = opts.addStyleTag;
    if (opts.viewportWidth || opts.viewportHeight) {
        body.viewport = { width: opts.viewportWidth || 1920, height: opts.viewportHeight || 1080 };
    }

    return cfFetch("screenshot", body, true);
}

/**
 * Generate a PDF from a URL or rendered HTML.
 * Returns raw PDF binary (ArrayBuffer).
 */
export async function pdf(opts: PdfOptions): Promise<ArrayBuffer> {
    const body: Record<string, any> = {};

    if (opts.url) body.url = opts.url;
    if (opts.html) body.html = opts.html;
    if (opts.pdfOptions) body.pdfOptions = opts.pdfOptions;
    if (opts.waitForSelector) body.gotoOptions = { ...body.gotoOptions, waitUntil: "networkidle0" };
    if (opts.waitForTimeout) body.waitForTimeout = opts.waitForTimeout;
    if (opts.addStyleTag) body.addStyleTag = opts.addStyleTag;

    return cfFetch("pdf", body, true);
}

/**
 * Extract structured data from a webpage using AI.
 * Returns parsed JSON matching the provided schema.
 */
export async function jsonExtract(opts: JsonExtractOptions): Promise<{ success: boolean; result: any }> {
    const body: Record<string, any> = {
        prompt: opts.prompt,
    };

    if (opts.url) body.url = opts.url;
    if (opts.html) body.html = opts.html;

    // CF /json requires a response_format — provide a sensible default
    body.response_format = opts.response_format || {
        type: "json_schema",
        schema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Title or name of the page/entity" },
                description: { type: "string", description: "Brief description or summary" },
                data: { type: "object", description: "Extracted structured data", additionalProperties: true },
            },
        },
    };

    if (opts.waitForSelector) body.waitForSelector = opts.waitForSelector;
    if (opts.waitForTimeout) body.waitForTimeout = opts.waitForTimeout;

    return cfFetch("json", body);
}

/**
 * Convert a webpage to clean markdown.
 */
export async function markdown(opts: MarkdownOptions): Promise<string> {
    const body: Record<string, any> = { url: opts.url };
    if (opts.waitForSelector) body.waitForSelector = opts.waitForSelector;
    if (opts.waitForTimeout) body.waitForTimeout = opts.waitForTimeout;

    return cfFetch("markdown", body);
}

/**
 * Capture a full DOM snapshot of a rendered page.
 */
export async function snapshot(opts: SnapshotOptions): Promise<string> {
    const body: Record<string, any> = { url: opts.url };
    if (opts.waitForSelector) body.waitForSelector = opts.waitForSelector;
    if (opts.waitForTimeout) body.waitForTimeout = opts.waitForTimeout;

    return cfFetch("snapshot", body);
}

/**
 * Scrape specific elements from a page using CSS selectors.
 */
export async function scrape(opts: ScrapeOptions): Promise<any> {
    const body: Record<string, any> = { elements: opts.elements };
    if (opts.url) body.url = opts.url;
    if (opts.html) body.html = opts.html;
    if (opts.waitForSelector) body.waitForSelector = opts.waitForSelector;
    if (opts.waitForTimeout) body.waitForTimeout = opts.waitForTimeout;

    return cfFetch("scrape", body);
}

/**
 * Extract all links from a webpage.
 */
export async function links(opts: LinksOptions): Promise<any> {
    const body: Record<string, any> = { url: opts.url };
    if (opts.waitForSelector) body.waitForSelector = opts.waitForSelector;
    if (opts.waitForTimeout) body.waitForTimeout = opts.waitForTimeout;

    return cfFetch("links", body);
}

// ─── /crawl (async multi-page) ──────────────────────────────────────

/**
 * Initiate an async crawl job. Returns a job ID — poll with `getCrawlStatus`.
 */
export async function startCrawl(opts: CrawlStartOptions): Promise<CrawlStartResponse> {
    const config = getConfig();
    const url = `${baseUrl(config)}/crawl`;

    const { url: target, ...rest } = opts;
    const body: Record<string, any> = { url: target, ...rest };

    const res = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`CF Browser /crawl start error (${res.status}): ${errText.slice(0, 400)}`);
    }
    return res.json();
}

/**
 * Fetch crawl job status and (optionally) its records.
 * Pass `limit: 1` for lightweight polling.
 */
export async function getCrawlStatus(
    jobId: string,
    query: CrawlStatusQuery = {}
): Promise<CrawlStatusResponse> {
    const config = getConfig();
    const params = new URLSearchParams();
    if (query.cursor !== undefined) params.set("cursor", String(query.cursor));
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.status) params.set("status", query.status);
    const qs = params.toString();
    const url = `${baseUrl(config)}/crawl/${jobId}${qs ? `?${qs}` : ""}`;

    const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiToken}` },
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`CF Browser /crawl status error (${res.status}): ${errText.slice(0, 400)}`);
    }
    return res.json();
}

/**
 * Cancel an in-progress crawl job.
 */
export async function cancelCrawl(jobId: string): Promise<{ success: boolean }> {
    const config = getConfig();
    const url = `${baseUrl(config)}/crawl/${jobId}`;

    const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.apiToken}` },
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`CF Browser /crawl cancel error (${res.status}): ${errText.slice(0, 400)}`);
    }
    return res.json().catch(() => ({ success: true }));
}

/**
 * Poll a crawl job until it reaches a terminal status, then page through
 * all records and return them concatenated.
 *
 * Defaults: 60 attempts × 5s ≈ 5 min. Tune for longer crawls.
 */
export async function waitForCrawl(
    jobId: string,
    opts: { maxAttempts?: number; delayMs?: number; recordsPerPage?: number } = {}
): Promise<CrawlStatusResult> {
    const maxAttempts = opts.maxAttempts ?? 60;
    const delayMs = opts.delayMs ?? 5000;
    const recordsPerPage = opts.recordsPerPage ?? 100;

    // 1. Poll until terminal
    let terminal: CrawlStatusResult | null = null;
    for (let i = 0; i < maxAttempts; i++) {
        const { result } = await getCrawlStatus(jobId, { limit: 1 });
        if (result.status !== "running") {
            terminal = result;
            break;
        }
        await new Promise((r) => setTimeout(r, delayMs));
    }
    if (!terminal) {
        throw new Error(`CF Browser /crawl ${jobId} did not finish within ${maxAttempts * delayMs}ms`);
    }

    if (terminal.status !== "completed") {
        return terminal;
    }

    // 2. Page through records
    const allRecords: CrawlRecord[] = [];
    let cursor: number | undefined = 0;
    while (true) {
        const { result }: CrawlStatusResponse = await getCrawlStatus(jobId, {
            cursor,
            limit: recordsPerPage,
        });
        if (result.records?.length) allRecords.push(...result.records);
        if (result.cursor === undefined || result.cursor === null) break;
        if (result.records && result.records.length < recordsPerPage) break;
        cursor = result.cursor;
    }

    return { ...terminal, records: allRecords };
}
