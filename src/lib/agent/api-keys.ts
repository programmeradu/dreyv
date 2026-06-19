/**
 * Per-user agent API keys. Keys are presented as
 *   Authorization: Bearer dak_<random>
 * Only the SHA-256 hash + 8-char prefix are stored.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { agentApiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";

const PREFIX = "dak_";

export interface MintedAgentKey {
    id: string;
    label: string;
    /** Only returned on creation — never readable again. */
    fullKey: string;
    keyPrefix: string;
    createdAt: Date;
}

export interface ResolvedAgentKey {
    id: string;
    userId: string;
    label: string;
    scopes: string[];
    spendLimitUsd: number | null;
    spentUsd: number;
}

function hashKey(raw: string): string {
    return createHash("sha256").update(raw, "utf8").digest("hex");
}

export async function mintAgentKey(args: {
    userId: string;
    label: string;
    spendLimitUsd?: number | null;
}): Promise<MintedAgentKey> {
    if (!db) throw new Error("Database unavailable");
    const label = args.label.trim().slice(0, 80) || "Untitled key";
    const random = randomBytes(28).toString("base64url"); // ~38 chars, URL-safe
    const fullKey = `${PREFIX}${random}`;
    const keyHash = hashKey(fullKey);
    const keyPrefix = fullKey.slice(0, 12); // e.g. "dak_abcd1234"

    const [row] = await db
        .insert(agentApiKeys)
        .values({
            userId: args.userId,
            label,
            keyPrefix,
            keyHash,
            spendLimitUsd:
                args.spendLimitUsd != null ? args.spendLimitUsd.toFixed(2) : null,
        })
        .returning({ id: agentApiKeys.id, createdAt: agentApiKeys.createdAt });

    return {
        id: row.id,
        label,
        fullKey,
        keyPrefix,
        createdAt: row.createdAt,
    };
}

/**
 * Verify a raw bearer string. Returns the key + user on match, null otherwise.
 * Bumps `lastUsedAt` on success.
 */
export async function resolveAgentKey(bearer: string | null): Promise<ResolvedAgentKey | null> {
    if (!bearer || !bearer.startsWith(PREFIX)) return null;
    if (!db) return null;

    const expectedHash = hashKey(bearer);
    const [row] = await db
        .select()
        .from(agentApiKeys)
        .where(eq(agentApiKeys.keyHash, expectedHash))
        .limit(1);

    if (!row) return null;
    if (row.revokedAt) return null;

    // Constant-time check defends against any future fuzzy lookup variants.
    try {
        const a = Buffer.from(expectedHash, "hex");
        const b = Buffer.from(row.keyHash, "hex");
        if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch {
        return null;
    }

    // Fire-and-forget; failures here must not block the request.
    db.update(agentApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(agentApiKeys.id, row.id))
        .catch(() => undefined);

    return {
        id: row.id,
        userId: row.userId,
        label: row.label,
        scopes: (row.scopes ?? "x402.pay").split(",").map((s: string) => s.trim()).filter(Boolean),
        spendLimitUsd: row.spendLimitUsd != null ? Number(row.spendLimitUsd) : null,
        spentUsd: row.spentUsd != null ? Number(row.spentUsd) : 0,
    };
}

export function extractBearer(req: Request): string | null {
    const h = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!h) return null;
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    return m ? m[1].trim() : null;
}
