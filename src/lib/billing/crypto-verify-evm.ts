/**
 * EVM payment verification — read tx receipt, confirm an ERC20 Transfer to
 * the receiving wallet for ≥ expectedMinor on the right token, and confirm
 * the memo bytes appended to the calldata.
 *
 * Memo convention (no native EVM memo):
 *   Standard ERC20 `transfer(address,uint256)` calldata is exactly 4+32+32 = 68 bytes.
 *   We append the UTF-8 memo as raw extra bytes after byte 68. ERC20s built on
 *   OpenZeppelin (every USDC/USDT we ship) ignore extra calldata, so the
 *   transfer succeeds and the memo is recoverable from `tx.input`.
 */
type Hex = `0x${string}`;
import type { CryptoChain } from "./crypto-config";

interface VerifyParams {
    chain: Exclude<CryptoChain, "solana">;
    txHash: string;
    receivingAddress: string;
    /** ERC20 contract for the asset. */
    contract: string;
    expectedMinor: bigint;
    memo: string;
}

interface VerifyResult {
    ok: boolean;
    reason?: string;
    actualMinor?: bigint;
}

const CHAIN_ID = { base: 8453, arbitrum: 42161, polygon: 137, bsc: 56 } as const;

interface EtherscanTx { to: string; input: string; }
interface EtherscanReceipt {
    status: string; // "0x1" success
    logs: Array<{ address: string; topics: string[]; data: string }>;
}

async function etherscanFetch<T>(chain: keyof typeof CHAIN_ID, action: string, txHash: string): Promise<T | null> {
    const key = process.env.ETHERSCAN_API_KEY;
    if (!key) return null;
    const url = `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID[chain]}&module=proxy&action=${action}&txhash=${txHash}&apikey=${key}`;
    try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return null;
        const j = await r.json();
        return (j?.result ?? null) as T | null;
    } catch { return null; }
}

async function fetchViaEtherscan(chain: keyof typeof CHAIN_ID, txHash: string) {
    const [tx, receipt] = await Promise.all([
        etherscanFetch<EtherscanTx>(chain, "eth_getTransactionByHash", txHash),
        etherscanFetch<EtherscanReceipt>(chain, "eth_getTransactionReceipt", txHash),
    ]);
    if (!tx || !receipt) return null;
    return { tx, receipt };
}

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC: Hex = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpcFetch<T>(chain: keyof typeof CHAIN_ID, method: string, params: any[]): Promise<T> {
    const url = process.env[`${chain.toUpperCase()}_RPC_URL`];
    if (!url) throw new Error("Missing RPC URL");
    const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    if (!r.ok) throw new Error("RPC fetch failed");
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result as T;
}

function pad32(addr: string): string {
    return "0x" + "0".repeat(24) + addr.toLowerCase().replace(/^0x/, "");
}

function hexToUtf8(hex: string): string {
    const clean = hex.replace(/^0x/, "");
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\u0000+$/, "");
}

export async function verifyEvmPayment(p: VerifyParams): Promise<VerifyResult> {
    // Try Etherscan V2 first (more reliable, single endpoint for all chains).
    let txTo: string | undefined;
    let txInput: string | undefined;
    let receiptStatus: "success" | "reverted" | undefined;
    let logs: Array<{ address: string; topics: readonly string[]; data: string }> = [];

    const es = await fetchViaEtherscan(p.chain, p.txHash);
    if (es) {
        txTo = es.tx.to;
        txInput = es.tx.input;
        receiptStatus = es.receipt.status === "0x1" ? "success" : "reverted";
        logs = es.receipt.logs.map(l => ({ address: l.address, topics: l.topics, data: l.data }));
    } else {
        // Fallback to public RPC via fetch.
        try {
            const [tx, receipt] = await Promise.all([
                rpcFetch<any>(p.chain, "eth_getTransactionByHash", [p.txHash]),
                rpcFetch<any>(p.chain, "eth_getTransactionReceipt", [p.txHash]),
            ]);
            if (!tx || !receipt) return { ok: false, reason: "tx_not_found" };
            txTo = tx.to ?? undefined;
            txInput = tx.input as string;
            receiptStatus = receipt.status === "0x1" ? "success" : "reverted";
            logs = receipt.logs.map((l: any) => ({ address: l.address, topics: l.topics, data: l.data }));
        } catch (err) {
            return { ok: false, reason: `rpc_error: ${(err as Error).message}` };
        }
    }

    if (receiptStatus !== "success") return { ok: false, reason: "tx_failed" };
    if (txTo?.toLowerCase() !== p.contract.toLowerCase()) {
        return { ok: false, reason: "wrong_token_contract" };
    }

    // Memo check — anything past byte 68 of the input is the memo payload.
    const input = txInput ?? "0x";
    if (input.length <= 2 + 68 * 2) return { ok: false, reason: "memo_missing" };
    const memoHex = input.slice(2 + 68 * 2);
    const decoded = hexToUtf8(memoHex);
    if (!decoded.includes(p.memo)) return { ok: false, reason: "memo_missing" };

    // Sum Transfer events from anyone → receivingAddress on this token.
    const recipientTopic = pad32(p.receivingAddress);
    const matching = logs.filter(l =>
        l.address.toLowerCase() === p.contract.toLowerCase() &&
        l.topics[0] === TRANSFER_TOPIC &&
        l.topics[2]?.toLowerCase() === recipientTopic,
    );
    if (matching.length === 0) return { ok: false, reason: "no_matching_transfer" };

    let total = BigInt(0);
    for (const log of matching) total += BigInt(log.data);
    if (total < p.expectedMinor) return { ok: false, reason: "underpaid", actualMinor: total };
    return { ok: true, actualMinor: total };
}
