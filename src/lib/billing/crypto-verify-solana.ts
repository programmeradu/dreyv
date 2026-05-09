/**
 * Solana payment verification — fetch tx by signature, confirm it credits
 * the receiving wallet with the expected mint+amount and includes the memo.
 */

interface VerifyParams {
    signature: string;
    receivingAddress: string;
    /** SPL mint address, or null for native SOL. */
    mint: string | null;
    /** Expected amount in smallest unit (lamports for SOL, base units for SPL). */
    expectedMinor: bigint;
    memo: string;
}

interface VerifyResult {
    ok: boolean;
    reason?: string;
    actualMinor?: bigint;
}

function getRpcUrl(): string {
    const helius = process.env.HELIUS_API_KEY?.trim();
    if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
    const fallback = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
    if (fallback) return fallback;
    throw new Error("No Solana RPC URL configured");
}

async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(getRpcUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
    });
    if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
    const json = await res.json() as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
    return json.result as T;
}

interface ParsedTx {
    meta?: {
        err?: unknown;
        innerInstructions?: unknown;
        preTokenBalances?: Array<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }>;
        postTokenBalances?: Array<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }>;
        logMessages?: string[];
        preBalances?: number[];
        postBalances?: number[];
    };
    transaction?: {
        message?: {
            accountKeys?: Array<{ pubkey: string } | string>;
            instructions?: Array<{ program?: string; programId?: string; parsed?: { type?: string; info?: unknown } }>;
        };
    };
}

export async function verifySolanaPayment(p: VerifyParams): Promise<VerifyResult> {
    let tx: ParsedTx | null;
    try {
        tx = await rpc<ParsedTx | null>("getTransaction", [
            p.signature,
            { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
        ]);
    } catch (err) {
        return { ok: false, reason: `rpc_error: ${(err as Error).message}` };
    }
    if (!tx || !tx.meta) return { ok: false, reason: "tx_not_found" };
    if (tx.meta.err) return { ok: false, reason: "tx_failed" };

    // Memo check — Memo program logs the payload.
    const logs = tx.meta.logMessages ?? [];
    const memoFound = logs.some(l => l.includes("Program log: Memo") && l.includes(p.memo));
    if (!memoFound) {
        // Some wallets emit "Program data:" — fall back to scanning instructions.
        const instrs = tx.transaction?.message?.instructions ?? [];
        const memoInstr = instrs.find(i => (i.program === "spl-memo" || i.programId === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"));
        const memoData = memoInstr?.parsed as string | undefined;
        if (!memoData || !String(memoData).includes(p.memo)) {
            return { ok: false, reason: "memo_missing" };
        }
    }

    // Amount check.
    if (p.mint === null) {
        // Native SOL transfer — diff lamports for the receiving address.
        const keys = (tx.transaction?.message?.accountKeys ?? []).map(k => typeof k === "string" ? k : k.pubkey);
        const idx = keys.indexOf(p.receivingAddress);
        if (idx < 0) return { ok: false, reason: "recipient_not_in_tx" };
        const pre = BigInt(tx.meta.preBalances?.[idx] ?? 0);
        const post = BigInt(tx.meta.postBalances?.[idx] ?? 0);
        const delta = post - pre;
        if (delta < p.expectedMinor) {
            return { ok: false, reason: "underpaid", actualMinor: delta };
        }
        return { ok: true, actualMinor: delta };
    }

    // SPL token transfer — find owner=receivingAddress, mint=expected, diff post-pre.
    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];
    const matches = post.filter(b => b.owner === p.receivingAddress && b.mint === p.mint);
    if (matches.length === 0) return { ok: false, reason: "no_matching_token_balance" };

    let totalDelta = 0n;
    for (const m of matches) {
        const preB = pre.find(x => x.accountIndex === m.accountIndex);
        const preAmt = BigInt(preB?.uiTokenAmount.amount ?? "0");
        const postAmt = BigInt(m.uiTokenAmount.amount);
        totalDelta += postAmt - preAmt;
    }
    if (totalDelta < p.expectedMinor) {
        return { ok: false, reason: "underpaid", actualMinor: totalDelta };
    }
    return { ok: true, actualMinor: totalDelta };
}
