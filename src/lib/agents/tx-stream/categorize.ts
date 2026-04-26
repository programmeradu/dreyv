/**
 * Phase 7B — Transaction categorization.
 *
 * Pipeline per Helius enhanced-tx:
 *   1. Normalize → ParsedTxFacts (direction, primary token, counterparty, etc).
 *   2. Apply user rules (highest priority enabled rule that matches wins).
 *   3. Fallback to built-in heuristics (program-id / source-based).
 *   4. Return CategorizedTx (category + tags + source label).
 *
 * No mocks. Pure function — no DB writes here. Persistence happens in the
 * Inngest worker that calls categorize().
 */

import type { HeliusEnhancedTx } from "./helius";

export type Category =
  | "swap"
  | "transfer-in"
  | "transfer-out"
  | "internal"
  | "payroll"
  | "yield"
  | "stake"
  | "unstake"
  | "fee"
  | "mev"
  | "nft"
  | "uncategorized";

export interface ParsedTxFacts {
    signature: string;
    blockTime: Date | null;
    slot: number | null;
    feeLamports: number;
    source: string | null;       // e.g. "JUPITER", "SQUADS"
    type: string | null;         // e.g. "SWAP", "TRANSFER"
    direction: "in" | "out" | "internal" | "unknown";
    counterparty: string | null;
    tokenMint: string | null;
    tokenSymbol: string | null;
    amount: number;              // human-readable
    amountLamports: string;      // bigint as string (numeric column)
    memo: string | null;
}

export interface CategoryRule {
    id: string;
    priority: number;
    enabled: boolean;
    matchProgramId: string | null;
    matchSource: string | null;
    matchCounterparty: string | null;
    matchTokenMint: string | null;
    matchMemoContains: string | null;
    matchMinAmount: string | number | null;
    matchMaxAmount: string | number | null;
    matchDirection: string | null; // in | out | internal | any
    category: string;
    tags: unknown;
}

export interface CategorizedTx extends ParsedTxFacts {
    category: Category | string;
    categorySource: string;        // "rule:<uuid>" | "builtin:<name>" | "default"
    matchedRuleId: string | null;
    tags: string[];
}

// ── Known program IDs / source labels ────────────────────────────────
// Helius enhanced-tx already gives us a `source` for most major programs;
// these are fallbacks for raw inspection of `accountData`/`instructions`.
export const KNOWN_PROGRAMS: Record<string, { source: string; category: Category; tags: string[] }> = {
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": { source: "JUPITER", category: "swap", tags: ["dex"] },
    "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB": { source: "JUPITER", category: "swap", tags: ["dex"] },
    "SqdsJrL3Pw8j6tNB4nxwSALShPPEFD3xvYbRoVtVfqM": { source: "SQUADS", category: "internal", tags: ["multisig"] },
    SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: { source: "SQUADS", category: "internal", tags: ["multisig"] },
    "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m": { source: "STREAMFLOW", category: "payroll", tags: ["streaming"] },
    "MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhNiJyJxFt": { source: "MARINADE", category: "stake", tags: ["lst"] },
    "Stake11111111111111111111111111111111111111": { source: "STAKE_PROGRAM", category: "stake", tags: ["native-stake"] },
    "11111111111111111111111111111111": { source: "SYSTEM", category: "transfer-out", tags: [] },
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: { source: "SPL_TOKEN", category: "transfer-out", tags: [] },
};

const SOURCE_TO_CATEGORY: Record<string, { category: Category; tags: string[] }> = {
    JUPITER: { category: "swap", tags: ["dex"] },
    JUPITER_LIMIT: { category: "swap", tags: ["dex", "limit"] },
    JUPITER_DCA: { category: "swap", tags: ["dex", "dca"] },
    RAYDIUM: { category: "swap", tags: ["dex", "amm"] },
    ORCA: { category: "swap", tags: ["dex", "amm"] },
    METEORA: { category: "swap", tags: ["dex", "dlmm"] },
    PHOENIX: { category: "swap", tags: ["dex", "clob"] },
    SQUADS: { category: "internal", tags: ["multisig"] },
    STREAMFLOW: { category: "payroll", tags: ["streaming"] },
    MARINADE: { category: "stake", tags: ["lst", "msol"] },
    JITO: { category: "mev", tags: ["jito"] },
    KAMINO: { category: "yield", tags: ["lend"] },
    MARGINFI: { category: "yield", tags: ["lend"] },
    DRIFT: { category: "yield", tags: ["perps"] },
    MAGIC_EDEN: { category: "nft", tags: ["marketplace"] },
    TENSOR: { category: "nft", tags: ["marketplace"] },
};

const TYPE_TO_CATEGORY: Record<string, Category> = {
    SWAP: "swap",
    TRANSFER: "transfer-out",
    NFT_SALE: "nft",
    NFT_LISTING: "nft",
    STAKE_SOL: "stake",
    UNSTAKE_SOL: "unstake",
};

// Common SOL/USDC/USDT mints for symbol resolution.
const KNOWN_MINTS: Record<string, string> = {
    So11111111111111111111111111111111111111112: "SOL",
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};

function extractMemo(tx: HeliusEnhancedTx): string | null {
    const desc = (tx as { description?: string }).description;
    if (typeof desc === "string" && desc.length > 0) return desc;
    return null;
}

/**
 * Convert a raw Helius enhanced tx into structured facts relative to the
 * watched wallet (so direction makes sense).
 */
export function parseTxFacts(tx: HeliusEnhancedTx, watchedWallet: string): ParsedTxFacts {
    const fee = typeof tx.fee === "number" ? tx.fee : 0;
    const blockTime = tx.timestamp ? new Date(tx.timestamp * 1000) : null;

    // Find primary transfer involving the watched wallet.
    let direction: "in" | "out" | "internal" | "unknown" = "unknown";
    let counterparty: string | null = null;
    let tokenMint: string | null = null;
    let tokenSymbol: string | null = null;
    let amount = 0;
    let amountLamports = "0";

    const native = (tx.nativeTransfers ?? []).find(
        (t) => t.fromUserAccount === watchedWallet || t.toUserAccount === watchedWallet,
    );
    const spl = (tx.tokenTransfers ?? []).find(
        (t) => t.fromUserAccount === watchedWallet || t.toUserAccount === watchedWallet,
    );

    if (spl) {
        direction = spl.fromUserAccount === watchedWallet ? "out" : "in";
        counterparty = direction === "out" ? spl.toUserAccount : spl.fromUserAccount;
        tokenMint = spl.mint;
        tokenSymbol = KNOWN_MINTS[spl.mint] ?? null;
        amount = Number(spl.tokenAmount) || 0;
        amountLamports = String(spl.tokenAmount);
    } else if (native) {
        direction = native.fromUserAccount === watchedWallet ? "out" : "in";
        counterparty = direction === "out" ? native.toUserAccount : native.fromUserAccount;
        tokenMint = "So11111111111111111111111111111111111111112";
        tokenSymbol = "SOL";
        amount = native.amount / 1e9;
        amountLamports = String(native.amount);
    } else {
        direction = "internal";
    }

    return {
        signature: tx.signature,
        blockTime,
        slot: tx.slot ?? null,
        feeLamports: fee,
        source: tx.source ?? null,
        type: tx.type ?? null,
        direction,
        counterparty,
        tokenMint,
        tokenSymbol,
        amount,
        amountLamports,
        memo: extractMemo(tx),
    };
}

function ruleMatches(rule: CategoryRule, facts: ParsedTxFacts): boolean {
    if (!rule.enabled) return false;
    if (rule.matchSource && facts.source !== rule.matchSource) return false;
    if (rule.matchTokenMint && facts.tokenMint !== rule.matchTokenMint) return false;
    if (rule.matchCounterparty && facts.counterparty !== rule.matchCounterparty) return false;
    if (rule.matchDirection && rule.matchDirection !== "any" && facts.direction !== rule.matchDirection) {
        return false;
    }
    if (rule.matchMemoContains) {
        if (!facts.memo || !facts.memo.toLowerCase().includes(rule.matchMemoContains.toLowerCase())) {
            return false;
        }
    }
    if (rule.matchMinAmount != null) {
        const min = Number(rule.matchMinAmount);
        if (Number.isFinite(min) && facts.amount < min) return false;
    }
    if (rule.matchMaxAmount != null) {
        const max = Number(rule.matchMaxAmount);
        if (Number.isFinite(max) && facts.amount > max) return false;
    }
    // matchProgramId: best-effort, looks at source mapping. Full program-id
    // matching against tx.instructions is left for a future pass.
    if (rule.matchProgramId) {
        const known = KNOWN_PROGRAMS[rule.matchProgramId];
        if (!known || facts.source !== known.source) return false;
    }
    return true;
}

function applyBuiltins(facts: ParsedTxFacts): { category: Category; tags: string[]; label: string } {
    if (facts.source && SOURCE_TO_CATEGORY[facts.source]) {
        const m = SOURCE_TO_CATEGORY[facts.source];
        return { ...m, label: `builtin:source:${facts.source}` };
    }
    if (facts.type && TYPE_TO_CATEGORY[facts.type]) {
        const cat = TYPE_TO_CATEGORY[facts.type];
        // Refine TRANSFER direction
        if (cat === "transfer-out" && facts.direction === "in") {
            return { category: "transfer-in", tags: [], label: `builtin:type:${facts.type}` };
        }
        return { category: cat, tags: [], label: `builtin:type:${facts.type}` };
    }
    if (facts.direction === "in") return { category: "transfer-in", tags: [], label: "builtin:direction" };
    if (facts.direction === "out") return { category: "transfer-out", tags: [], label: "builtin:direction" };
    return { category: "uncategorized", tags: [], label: "default" };
}

/**
 * Categorize a single Helius enhanced tx for a watched wallet.
 *
 * @param tx     Helius enhanced tx
 * @param wallet The wallet we're indexing for
 * @param rules  User rules (already filtered to this owner). Pass [] if none.
 */
export function categorize(
    tx: HeliusEnhancedTx,
    wallet: string,
    rules: CategoryRule[] = [],
): CategorizedTx {
    const facts = parseTxFacts(tx, wallet);

    // Sort rules by priority DESC (high priority wins).
    const sorted = [...rules].filter((r) => r.enabled).sort((a, b) => b.priority - a.priority);
    for (const rule of sorted) {
        if (ruleMatches(rule, facts)) {
            const tags = Array.isArray(rule.tags) ? (rule.tags as string[]) : [];
            return {
                ...facts,
                category: rule.category,
                categorySource: `rule:${rule.id}`,
                matchedRuleId: rule.id,
                tags,
            };
        }
    }

    const builtin = applyBuiltins(facts);
    return {
        ...facts,
        category: builtin.category,
        categorySource: builtin.label,
        matchedRuleId: null,
        tags: builtin.tags,
    };
}
