/**
 * Known on-chain address labels for the smart explorer.
 * Used by counterparty graph, activity timeline, and archetype classifier.
 * Conservative list — only well-known, publicly attributed addresses.
 */

export interface AddressLabel {
  label: string;
  category: "dex" | "lending" | "lst" | "cex" | "mm" | "bridge" | "multisig" | "validator" | "perps";
  logoSlug?: string; // matches src/lib/protocol-logos.ts
}

export const SOLANA_LABELS: Record<string, AddressLabel> = {
  // DEX aggregators / AMMs
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: { label: "Jupiter Aggregator", category: "dex", logoSlug: "jupiter" },
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB": { label: "Jupiter v4", category: "dex", logoSlug: "jupiter" },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { label: "Orca Whirlpools", category: "dex", logoSlug: "orca" },
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": { label: "Raydium AMM", category: "dex", logoSlug: "raydium" },
  // LSTs
  MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhJk8X1cM5Z: { label: "Marinade", category: "lst", logoSlug: "marinade" },
  JitoSOLLST1111111111111111111111111111111: { label: "Jito Stake Pool", category: "lst", logoSlug: "jito" },
  // Lending
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: { label: "Kamino Lend", category: "lending", logoSlug: "kamino" },
  MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA: { label: "MarginFi", category: "lending", logoSlug: "marginfi" },
  // Perps
  JCFRaKv5vCgwt37W3rAefMK1AGvJYrgsfutdpqGsdcZ8: { label: "Drift Protocol", category: "perps", logoSlug: "drift" },
  // CEX hot wallets (publicly attributed)
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": { label: "Binance Hot Wallet", category: "cex" },
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": { label: "Binance 2", category: "cex" },
  H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS: { label: "Coinbase Hot", category: "cex" },
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": { label: "Coinbase 2", category: "cex" },
  AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2: { label: "Bybit Hot", category: "cex" },
  // Multisig program
  SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu: { label: "Squads Multisig", category: "multisig" },
  // Market makers (publicly attributed Wintermute hot wallet)
  "5PAhQiYdLBd6SVdpzBN3HoYAt4cKDmKEXmAfQbqzj9MN": { label: "Wintermute", category: "mm" },
};

export function lookupSolanaLabel(address: string): AddressLabel | null {
  return SOLANA_LABELS[address] ?? null;
}

export const EVM_LABELS: Record<string, AddressLabel> = {
  "0x28c6c06298d514db089934071355e5743bf21d60": { label: "Binance 14", category: "cex" },
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": { label: "Binance 16", category: "cex" },
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": { label: "Coinbase 1", category: "cex" },
  "0xf977814e90da44bfa03b6295a0616a897441acec": { label: "Binance 8", category: "cex" },
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": { label: "Coinbase 10", category: "cex" },
  // Uniswap v3 router
  "0xe592427a0aece92de3edee1f18e0157c05861564": { label: "Uniswap v3 Router", category: "dex" },
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": { label: "Uniswap Universal Router", category: "dex" },
  // Aave v3
  "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2": { label: "Aave v3 Pool", category: "lending" },
};

export function lookupEvmLabel(address: string): AddressLabel | null {
  return EVM_LABELS[address.toLowerCase()] ?? null;
}

export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address || "";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
