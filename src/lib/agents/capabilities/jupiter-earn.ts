import { resolveTokenMint, tokenDecimals } from "./tokens";

const JUP_EARN_BASE = "https://api.jup.ag/lend/v1/earn";

export interface JupiterEarnMarket {
  address: string;
  name: string;
  symbol: string;
  uiSymbol?: string;
  assetAddress: string;
  asset?: { symbol?: string; uiSymbol?: string; decimals?: number; price?: string | number };
  totalRate?: string | number;
  supplyRate?: string | number;
  rewardsRate?: string | number;
  totalAssets?: string;
}

let marketCache: { rows: JupiterEarnMarket[]; expires: number } | null = null;

export async function listJupiterEarnMarkets(): Promise<JupiterEarnMarket[]> {
  const now = Date.now();
  if (marketCache && marketCache.expires > now) return marketCache.rows;
  const res = await fetch(`${JUP_EARN_BASE}/tokens`, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Jupiter Earn markets failed: HTTP ${res.status}`);
  const rows = (await res.json()) as JupiterEarnMarket[];
  marketCache = { rows: Array.isArray(rows) ? rows : [], expires: now + 60_000 };
  return marketCache.rows;
}

export async function findJupiterEarnMarket(token: string): Promise<JupiterEarnMarket | null> {
  const mint = resolveTokenMint(token) || token;
  const upper = token.toUpperCase();
  const markets = await listJupiterEarnMarkets();
  return markets.find((m) =>
    m.assetAddress === mint ||
    m.asset?.symbol?.toUpperCase() === upper ||
    m.asset?.uiSymbol?.toUpperCase() === upper ||
    m.symbol?.toUpperCase() === upper,
  ) ?? null;
}

export function earnApyPct(market: JupiterEarnMarket): number {
  const raw = Number(market.totalRate ?? market.supplyRate ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 100 ? raw / 100 : raw;
}

export function tokenAmountToRaw(token: string, amount: number, market?: JupiterEarnMarket): string {
  const decimals = market?.asset?.decimals ?? tokenDecimals(token);
  return String(Math.floor(amount * Math.pow(10, decimals)));
}

export async function buildJupiterEarnDepositTx(args: {
  token: string;
  amount: number;
  signer: string;
  market?: JupiterEarnMarket | null;
}): Promise<{ transaction: string; market: JupiterEarnMarket; amountRaw: string }> {
  const market = args.market ?? await findJupiterEarnMarket(args.token);
  if (!market) throw new Error(`No Jupiter Earn market found for ${args.token}`);
  const amountRaw = tokenAmountToRaw(args.token, args.amount, market);
  const res = await fetch(`${JUP_EARN_BASE}/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset: market.assetAddress, amount: amountRaw, signer: args.signer }),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jupiter Earn deposit failed: HTTP ${res.status} ${text.slice(0, 240)}`);
  const json = JSON.parse(text) as { transaction?: string };
  if (!json.transaction) throw new Error("Jupiter Earn returned no unsigned transaction");
  return { transaction: json.transaction, market, amountRaw };
}