/**
 * DACS Phase 0 — shared token mint registry + decimal helpers.
 *
 * Lifted from `src/app/api/command/route.ts` so every capability module reads
 * from one source of truth. Phase 6 cutover removes the inline copy in route.ts.
 *
 * Add new tokens by appending to TOKEN_MINTS — capabilities resolve symbols
 * via `resolveTokenMint(symbol)` and never hard-code mints.
 */

export const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  WSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  PYUSD: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  USDS: "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZxHZCGCRaeLJZoFpK6XNbRIo5jZbGT5",
  ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  JITO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  BSOL: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  STSOL: "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  TRUMP: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
};

export function resolveTokenMint(symbol: string): string | null {
  return TOKEN_MINTS[symbol.toUpperCase()] || null;
}

export function tokenDecimals(symbol: string): number {
  return ["USDC", "USDT", "PYUSD", "USDS"].includes(symbol.toUpperCase()) ? 6 : 9;
}

export function isSolSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return s === "SOL" || s === "WSOL";
}
