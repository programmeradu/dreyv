/**
 * Alchemy multi-chain RPC + token balance client.
 * Requires `ALCHEMY_API_KEY` (server-side). Falls back to isReady=false if absent.
 *
 * Coverage: ethereum, base, arbitrum, polygon, bsc.
 * We use Alchemy's Token API (`alchemy_getTokenBalances`) which is the
 * cheapest way to enumerate an EVM wallet's holdings.
 */
import type { Chain, DataFeed, ChainEvent, DreyvEvent } from "./normalize";

const ENDPOINTS: Record<Exclude<Chain, "solana" | "off-chain">, string> = {
  ethereum: "https://eth-mainnet.g.alchemy.com/v2",
  base: "https://base-mainnet.g.alchemy.com/v2",
  arbitrum: "https://arb-mainnet.g.alchemy.com/v2",
  polygon: "https://polygon-mainnet.g.alchemy.com/v2",
  bsc: "https://bnb-mainnet.g.alchemy.com/v2",
};

export interface AlchemyInput {
  chain: Exclude<Chain, "solana" | "off-chain">;
  address: string;
}

function key(): string | undefined {
  return process.env.ALCHEMY_API_KEY;
}

export const alchemyFeed: DataFeed<AlchemyInput> = {
  id: "alchemy",
  isReady: () => Boolean(key()),
  async fetch({ chain, address }) {
    const k = key();
    if (!k) return [];
    const base = ENDPOINTS[chain];
    if (!base) return [];

    const res = await fetch(`${base}/${k}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "alchemy_getTokenBalances",
        params: [address, "erc20"],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const balances: any[] = data?.result?.tokenBalances || [];
    const observedAt = new Date().toISOString();

    return balances
      .filter((b) => b?.tokenBalance && b.tokenBalance !== "0x0")
      .slice(0, 100)
      .map<ChainEvent>((b) => ({
        kind: "chain",
        observedAt,
        source: "alchemy",
        chain,
        signatureOrHash: `${address}:${b.contractAddress}`,
        walletAddress: address,
        type: "transfer",
        raw: b,
      })) as DreyvEvent[];
  },
};

/** Cheap helper: latest block number for a chain. */
export async function getLatestBlock(
  chain: Exclude<Chain, "solana" | "off-chain">,
): Promise<number | null> {
  const k = key();
  if (!k) return null;
  const base = ENDPOINTS[chain];
  if (!base) return null;
  const res = await fetch(`${base}/${k}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const hex = data?.result;
  return typeof hex === "string" ? parseInt(hex, 16) : null;
}
