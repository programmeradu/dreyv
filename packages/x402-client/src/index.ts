/**
 * @dreyv/x402-client
 *
 * Buyer-side SDK for the x402 (HTTP 402 Payment Required) protocol.
 *
 * Give any AI agent — elizaOS, Solana Agent Kit, LangGraph, Mastra,
 * MCP tool, or a plain Node script — a wallet, a per-run budget, and an
 * auditable receipt trail. The SDK issues the request, catches the 402,
 * settles the payment via a Dreyv facilitator (prepaid balance → custodial
 * USDC wallet), retries with `X-PAYMENT`, and returns the fulfilled
 * response plus a structured receipt.
 *
 * Works against ANY x402-compliant seller — Cloudflare Monetization
 * Gateway endpoints, dreyv SKUs, Coinbase-facilitated APIs, self-hosted
 * origins. The seller decides the price; the SDK enforces the buyer's cap.
 *
 * ── Minimal usage ────────────────────────────────────────────────────────
 *
 *   import { DreyvX402Client } from "@dreyv/x402-client";
 *
 *   const dreyv = new DreyvX402Client({
 *     apiKey: process.env.DREYV_API_KEY!,     // dk_live_… or dak_…
 *     maxPricePerCallUsd: 0.25,               // hard cap per request
 *     budgetUsd: 5,                           // hard cap across the run
 *   });
 *
 *   const res = await dreyv.fetch("https://api.some-seller.com/premium/report", {
 *     method: "POST",
 *     body: { symbol: "SOL" },
 *   });
 *
 *   console.log(res.upstream.body);
 *   console.log(res.payment?.explorer);      // solscan link, if paid
 *
 * The client never signs anything itself — Dreyv's facilitator holds the
 * custodial key and signs the SPL transfer on the agent's behalf, which
 * keeps the SDK safe to ship inside untrusted agent runtimes.
 */

export const X402_CLIENT_VERSION = "0.1.0";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface DreyvX402ClientOptions {
    /** Dreyv API key. `dk_live_…` (user) or `dak_…` (agent-scoped). */
    apiKey: string;
    /**
     * Hard per-request USD cap. If the seller quotes more, the SDK refuses
     * and returns `over_budget` — it never silently pays more.
     * Default: 1.00 USDC.
     */
    maxPricePerCallUsd?: number;
    /**
     * Optional total-run budget in USD. The SDK tracks cumulative spend
     * across every `.fetch()` on this instance and throws `BudgetExceeded`
     * before issuing the next paid call.
     */
    budgetUsd?: number;
    /**
     * Override the facilitator base URL. Defaults to Dreyv production.
     * Useful for staging or self-hosted facilitators.
     */
    baseUrl?: string;
    /**
     * Preferred settlement network hint. Passed through to the facilitator.
     * Default: "solana" (mainnet).
     */
    network?: "solana" | "solana-mainnet" | "solana-devnet";
    /** Optional fetch impl (Node <18 or test doubles). */
    fetchImpl?: typeof fetch;
}

export interface X402RequestInit {
    method?: HttpMethod;
    headers?: Record<string, string>;
    /** JSON-serializable object OR a raw string. */
    body?: unknown;
    /** Per-call override of `maxPricePerCallUsd`. */
    maxPriceUsd?: number;
}

export interface X402PaymentReceipt {
    signature: string;
    explorer: string;
    amount_usdc: string;
    amount_minor: string;
    asset: "USDC";
    network: string;
    payTo: string;
    memo: string;
    from_wallet: string;
}

export interface X402UpstreamResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
    truncated: boolean;
}

export interface X402Response {
    ok: boolean;
    paid: boolean;
    upstream: X402UpstreamResponse;
    payment?: X402PaymentReceipt;
}

export class X402Error extends Error {
    readonly code: string;
    readonly status: number;
    readonly details: unknown;
    constructor(code: string, status: number, message: string, details?: unknown) {
        super(message);
        this.name = "X402Error";
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

export class BudgetExceededError extends X402Error {
    constructor(spentUsd: number, budgetUsd: number) {
        super(
            "budget_exceeded",
            402,
            `Run budget of $${budgetUsd.toFixed(2)} already reached (spent $${spentUsd.toFixed(2)}).`,
            { spentUsd, budgetUsd },
        );
        this.name = "BudgetExceededError";
    }
}

const DEFAULT_BASE_URL = "https://dreyv.com";

export class DreyvX402Client {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly maxPricePerCallUsd: number;
    private readonly budgetUsd: number | null;
    private readonly network: string | undefined;
    private readonly fetchImpl: typeof fetch;
    private spentUsd = 0;
    private readonly receipts: X402PaymentReceipt[] = [];

    constructor(opts: DreyvX402ClientOptions) {
        if (!opts.apiKey || typeof opts.apiKey !== "string") {
            throw new X402Error("invalid_api_key", 400, "apiKey is required (dk_live_… or dak_…)");
        }
        this.apiKey = opts.apiKey;
        this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
        this.maxPricePerCallUsd = opts.maxPricePerCallUsd ?? 1;
        this.budgetUsd = opts.budgetUsd ?? null;
        this.network = opts.network;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const globalFetch = (typeof fetch !== "undefined" ? fetch : undefined) as any;
        const impl = opts.fetchImpl ?? globalFetch;
        if (!impl) {
            throw new X402Error("no_fetch", 500, "No fetch implementation available. Pass `fetchImpl` on Node < 18.");
        }
        this.fetchImpl = impl;
    }

    /** Total USD paid across every `.fetch()` on this instance. */
    get spent(): number {
        return this.spentUsd;
    }

    /** Every settled receipt, oldest-first, for audit trails. */
    get history(): readonly X402PaymentReceipt[] {
        return this.receipts;
    }

    async fetch(url: string, init: X402RequestInit = {}): Promise<X402Response> {
        const maxPriceUsd = init.maxPriceUsd ?? this.maxPricePerCallUsd;
        if (this.budgetUsd != null && this.spentUsd >= this.budgetUsd) {
            throw new BudgetExceededError(this.spentUsd, this.budgetUsd);
        }
        if (this.budgetUsd != null && this.spentUsd + maxPriceUsd > this.budgetUsd) {
            throw new BudgetExceededError(this.spentUsd, this.budgetUsd);
        }

        const res = await this.fetchImpl(`${this.baseUrl}/api/x402/proxy`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${this.apiKey}`,
                "user-agent": `dreyv-x402-client/${X402_CLIENT_VERSION}`,
            },
            body: JSON.stringify({
                url,
                method: init.method ?? "GET",
                headers: init.headers,
                body: init.body,
                max_price_usd: maxPriceUsd,
                network: this.network,
            }),
        });

        let json: unknown;
        try {
            json = await res.json();
        } catch {
            throw new X402Error("facilitator_bad_json", res.status, "Facilitator returned non-JSON response");
        }

        if (!res.ok || (isRecord(json) && json.ok === false)) {
            const reason = isRecord(json) && typeof json.reason === "string" ? json.reason : "facilitator_error";
            throw new X402Error(reason, res.status, `Payment relay failed (${reason})`, json);
        }

        const shaped = json as X402Response;
        if (shaped.paid && shaped.payment) {
            const amount = Number(shaped.payment.amount_usdc);
            if (Number.isFinite(amount)) this.spentUsd += amount;
            this.receipts.push(shaped.payment);
        }
        return shaped;
    }

    /**
     * Convenience: parse the upstream body as JSON. Throws if the seller
     * didn't return JSON.
     */
    async fetchJson<T = unknown>(url: string, init: X402RequestInit = {}): Promise<{ data: T; payment?: X402PaymentReceipt }> {
        const res = await this.fetch(url, init);
        let data: T;
        try {
            data = JSON.parse(res.upstream.body) as T;
        } catch {
            throw new X402Error("upstream_not_json", res.upstream.status, "Upstream body was not valid JSON");
        }
        return { data, payment: res.payment };
    }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}
