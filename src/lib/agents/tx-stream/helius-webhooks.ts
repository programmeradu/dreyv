/**
 * Phase 7B — Helius webhook management.
 *
 * Wraps the Helius `/v0/webhooks` REST API so we can register, update and
 * delete webhooks per watched wallet. Each watched wallet gets its own
 * webhook id (or appended to a shared one — Helius supports up to 100k
 * accounts per webhook). For simplicity we use ONE shared webhook per
 * Dreyv deployment and patch its address list as wallets come and go.
 *
 * Docs: https://docs.helius.dev/webhooks-and-websockets/api-reference
 */

const HELIUS_BASE = "https://api.helius.xyz";

function getKey(): string {
    const k = process.env.HELIUS_API_KEY;
    if (!k) throw new Error("HELIUS_API_KEY is not configured");
    return k;
}

function getWebhookUrl(): string {
    const base = (
        process.env.NEXT_PUBLIC_APP_URL || ""
    ).replace(/\/$/, "");
    if (!base) throw new Error("NEXT_PUBLIC_APP_URL must be set for Helius webhook target");
    return `${base}/api/webhooks/helius`;
}

function getAuthHeader(): string {
    // Helius supports a custom Authorization header on the webhook callback.
    // We use a long-random shared secret stored in env.
    const s = process.env.HELIUS_WEBHOOK_AUTH;
    if (!s) throw new Error("HELIUS_WEBHOOK_AUTH is not configured (random shared secret)");
    return s;
}

export interface HeliusWebhook {
    webhookID: string;
    wallet?: string;
    webhookURL: string;
    transactionTypes: string[];
    accountAddresses: string[];
    webhookType: string;
    authHeader?: string;
}

export async function listWebhooks(): Promise<HeliusWebhook[]> {
    const res = await fetch(`${HELIUS_BASE}/v0/webhooks?api-key=${getKey()}`, {
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`helius listWebhooks ${res.status}: ${await res.text()}`);
    return (await res.json()) as HeliusWebhook[];
}

export async function createWebhook(addresses: string[]): Promise<HeliusWebhook> {
    const body = {
        webhookURL: getWebhookUrl(),
        transactionTypes: ["Any"],
        accountAddresses: addresses,
        webhookType: "enhanced",
        authHeader: getAuthHeader(),
    };
    const res = await fetch(`${HELIUS_BASE}/v0/webhooks?api-key=${getKey()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`helius createWebhook ${res.status}: ${await res.text()}`);
    return (await res.json()) as HeliusWebhook;
}

export async function updateWebhook(
    webhookId: string,
    addresses: string[],
): Promise<HeliusWebhook> {
    const body = {
        webhookURL: getWebhookUrl(),
        transactionTypes: ["Any"],
        accountAddresses: addresses,
        webhookType: "enhanced",
        authHeader: getAuthHeader(),
    };
    const res = await fetch(
        `${HELIUS_BASE}/v0/webhooks/${webhookId}?api-key=${getKey()}`,
        {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        },
    );
    if (!res.ok) throw new Error(`helius updateWebhook ${res.status}: ${await res.text()}`);
    return (await res.json()) as HeliusWebhook;
}

export async function deleteWebhook(webhookId: string): Promise<void> {
    const res = await fetch(
        `${HELIUS_BASE}/v0/webhooks/${webhookId}?api-key=${getKey()}`,
        { method: "DELETE" },
    );
    if (!res.ok && res.status !== 404) {
        throw new Error(`helius deleteWebhook ${res.status}: ${await res.text()}`);
    }
}

/**
 * Idempotent: ensure a single shared Dreyv webhook exists with the exact
 * address set provided. Returns the webhook id. Reuses any existing
 * webhook whose URL matches our target.
 */
export async function syncSharedWebhook(addresses: string[]): Promise<string> {
    const target = getWebhookUrl();
    const existing = (await listWebhooks()).find((w) => w.webhookURL === target);

    const dedup = Array.from(new Set(addresses));
    if (!existing) {
        if (dedup.length === 0) {
            // Helius requires at least one address — nothing to register.
            return "";
        }
        const created = await createWebhook(dedup);
        return created.webhookID;
    }
    // Update only if the address set changed.
    const same =
        existing.accountAddresses.length === dedup.length &&
        existing.accountAddresses.every((a) => dedup.includes(a));
    if (!same) await updateWebhook(existing.webhookID, dedup);
    return existing.webhookID;
}
