/**
 * Phase 7A — Helius enhanced-transactions client.
 *
 * Real call to Helius `/v0/addresses/:addr/transactions` parsed-tx endpoint.
 * Used by `treasury_report_pdf` and `expense_categorize`. No mocks: throws if
 * `HELIUS_API_KEY` is missing or upstream returns an error.
 *
 * Docs: https://docs.helius.dev/reference/parse-transaction-history
 */

const HELIUS_BASE = "https://api.helius.xyz";

export interface HeliusEnhancedTx {
    signature: string;
    timestamp: number;            // unix seconds
    slot: number;
    type?: string;                // e.g. "TRANSFER", "SWAP"
    source?: string;              // e.g. "JUPITER", "SQUADS"
    description?: string;
    fee?: number;
    feePayer?: string;
    nativeTransfers?: Array<{
        fromUserAccount: string;
        toUserAccount: string;
        amount: number;             // lamports
    }>;
    tokenTransfers?: Array<{
        fromUserAccount: string;
        toUserAccount: string;
        mint: string;
        tokenAmount: number;
        tokenStandard?: string;
    }>;
    transactionError?: { error: string } | null;
    accountData?: unknown;
    instructions?: unknown;
}

function getKey(): string {
    const k = process.env.HELIUS_API_KEY ?? process.env.NEXT_PUBLIC_HELIUS_API_KEY;
    if (!k) {
        throw new Error("HELIUS_API_KEY is not configured. Set it in env to enable enhanced tx queries.");
    }
    return k;
}

export interface FetchHeliusOpts {
    /** UNIX seconds inclusive lower bound. */
    sinceUnix?: number;
    /** UNIX seconds inclusive upper bound. */
    untilUnix?: number;
    /** Max txs to walk back through (paginated 100/page). Default 1000. */
    limit?: number;
}

/**
 * Pull enhanced-tx history for an address, paginated until we cross
 * `sinceUnix` (or run out of history, or hit `limit`).
 */
export async function fetchHeliusTransactions(
    address: string,
    opts: FetchHeliusOpts = {},
): Promise<HeliusEnhancedTx[]> {
    const key = getKey();
    const limit = Math.min(opts.limit ?? 1000, 5000);
    const sinceUnix = opts.sinceUnix ?? 0;
    const untilUnix = opts.untilUnix ?? Number.MAX_SAFE_INTEGER;

    const out: HeliusEnhancedTx[] = [];
    let before: string | undefined;
    let pages = 0;

    while (out.length < limit && pages < 50) {
        const url = new URL(`${HELIUS_BASE}/v0/addresses/${address}/transactions`);
        url.searchParams.set("api-key", key);
        url.searchParams.set("limit", "100");
        if (before) url.searchParams.set("before", before);

        const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Helius error ${res.status}: ${body.slice(0, 240)}`);
        }
        const page = (await res.json()) as HeliusEnhancedTx[];
        if (!Array.isArray(page) || page.length === 0) break;

        let crossedLowerBound = false;
        for (const tx of page) {
            if (tx.timestamp > untilUnix) continue;
            if (tx.timestamp < sinceUnix) {
                crossedLowerBound = true;
                continue;
            }
            out.push(tx);
            if (out.length >= limit) break;
        }
        before = page[page.length - 1]?.signature;
        pages += 1;
        if (crossedLowerBound) break;
        if (page.length < 100) break;
    }

    return out;
}

/** Convenience: month string ("2026-04") → [sinceUnix, untilUnix]. */
export function monthRange(month: string): { since: number; until: number; label: string } {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) throw new Error(`Invalid month "${month}"; expected YYYY-MM.`);
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const since = Date.UTC(y, mo - 1, 1) / 1000;
    const until = Date.UTC(y, mo, 1) / 1000 - 1;
    const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    });
    return { since, until, label };
}
