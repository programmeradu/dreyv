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
import { createPublicClient, http, type Hex, type Log } from "viem";
import { base, arbitrum, polygon, bsc } from "viem/chains";
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

const CHAIN_MAP = { base, arbitrum, polygon, bsc } as const;
const CHAIN_ID = { base: 8453, arbitrum: 42161, polygon: 137, bsc: 56 } as const;

interface EtherscanTx { to: string; input: string; }
interface EtherscanReceipt {
    status: string; // "0x1" success
    logs: Array<{ address: string; topics: string[]; data: string }>;
}

async function etherscanFetch<T>(chain: keyof typeof CHAIN_MAP, action: string, txHash: string): Promise<T | null> {
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

async function fetchViaEtherscan(chain: keyof typeof CHAIN_MAP, txHash: string) {
    const [tx, receipt] = await Promise.all([
        etherscanFetch<EtherscanTx>(chain, "eth_getTransactionByHash", txHash),
        etherscanFetch<EtherscanReceipt>(chain, "eth_getTransactionReceipt", txHash),
    ]);
    if (!tx || !receipt) return null;
    return { tx, receipt };
}

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC: Hex = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function clientFor(chain: keyof typeof CHAIN_MAP) {
    const url = process.env[`${chain.toUpperCase()}_RPC_URL`];
    return createPublicClient({ chain: CHAIN_MAP[chain], transport: http(url) });
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
    const client = clientFor(p.chain);
    let tx, receipt;
    try {
        [tx, receipt] = await Promise.all([
            client.getTransaction({ hash: p.txHash as Hex }),
            client.getTransactionReceipt({ hash: p.txHash as Hex }),
        ]);
    } catch (err) {
        return { ok: false, reason: `rpc_error: ${(err as Error).message}` };
    }
    if (!tx || !receipt) return { ok: false, reason: "tx_not_found" };
    if (receipt.status !== "success") return { ok: false, reason: "tx_failed" };

    // Must call the right token contract.
    if (tx.to?.toLowerCase() !== p.contract.toLowerCase()) {
        return { ok: false, reason: "wrong_token_contract" };
    }

    // Memo check — anything past byte 68 of the input is the memo payload.
    const input = tx.input as string;
    if (input.length <= 2 + 68 * 2) return { ok: false, reason: "memo_missing" };
    const memoHex = input.slice(2 + 68 * 2);
    const decoded = hexToUtf8(memoHex);
    if (!decoded.includes(p.memo)) return { ok: false, reason: "memo_missing" };

    // Sum Transfer events from anyone → receivingAddress on this token.
    const recipientTopic = pad32(p.receivingAddress);
    const matching = receipt.logs.filter((l: Log) =>
        l.address.toLowerCase() === p.contract.toLowerCase() &&
        l.topics[0] === TRANSFER_TOPIC &&
        l.topics[2]?.toLowerCase() === recipientTopic,
    );
    if (matching.length === 0) return { ok: false, reason: "no_matching_transfer" };

    let total = BigInt(0);
    for (const log of matching) total += BigInt(log.data as string);
    if (total < p.expectedMinor) return { ok: false, reason: "underpaid", actualMinor: total };
    return { ok: true, actualMinor: total };
}
