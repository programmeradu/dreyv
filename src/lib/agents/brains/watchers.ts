/**
 * Treasury watcher storage + scan helpers.
 *
 * A watcher = a (chain, address) tuple owned by a user. The cadence
 * `treasuryWatch5m` sweeps every active watcher, fetches fresh
 * balances via Alchemy/Covalent (EVM) or Helius (Solana), diffs them
 * against `lastSnapshot`, and surfaces user-scoped opportunities when
 * material movement is detected.
 *
 * All functions degrade gracefully when DATABASE_URL or the relevant
 * provider key is missing.
 */
import { db } from "@/db";
import { agentTreasuryWatchers, users } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { alchemyFeed } from "@/lib/datafeeds/alchemy";
import { covalentFeed } from "@/lib/datafeeds/covalent";

export type WatcherChain =
  | "solana"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "polygon"
  | "bsc";

export interface TreasuryWatcher {
  id: string;
  userId: string | null;
  chain: WatcherChain;
  address: string;
  label: string | null;
  active: boolean;
  lastScanAt: Date | string | null;
  lastSnapshot: unknown;
  createdAt: Date | string;
}

export async function listWatchers(opts: { userId?: string; activeOnly?: boolean } = {}) {
  if (!db) return [] as TreasuryWatcher[];
  try {
    const where = opts.userId
      ? opts.activeOnly
        ? and(eq(agentTreasuryWatchers.userId, opts.userId), eq(agentTreasuryWatchers.active, true))
        : eq(agentTreasuryWatchers.userId, opts.userId)
      : opts.activeOnly
      ? eq(agentTreasuryWatchers.active, true)
      : undefined;
    const q = db.select().from(agentTreasuryWatchers).orderBy(desc(agentTreasuryWatchers.createdAt));
    const rows = where ? await q.where(where) : await q;
    return rows as unknown as TreasuryWatcher[];
  } catch (e: any) {
    console.warn("[watchers] list failed", e?.message);
    return [];
  }
}

export async function listWatchersByWallet(walletAddress: string) {
  if (!db) return [] as TreasuryWatcher[];
  try {
    const u = await db.select({ id: users.id }).from(users).where(eq(users.walletAddress, walletAddress)).limit(1);
    if (!u.length) return [];
    return await listWatchers({ userId: u[0].id });
  } catch (e: any) {
    console.warn("[watchers] listByWallet failed", e?.message);
    return [];
  }
}

export async function upsertWatcher(input: {
  walletAddress: string; // owner's connected wallet — resolved to users.id
  chain: WatcherChain;
  address: string;
  label?: string;
}): Promise<TreasuryWatcher | null> {
  if (!db) return null;
  try {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.walletAddress, input.walletAddress))
      .limit(1);
    const userId = u?.id ?? null;
    const [row] = await db
      .insert(agentTreasuryWatchers)
      .values({
        userId,
        chain: input.chain,
        address: input.address,
        label: input.label ?? null,
        active: true,
      })
      .returning();
    return row as unknown as TreasuryWatcher;
  } catch (e: any) {
    console.warn("[watchers] upsert failed", e?.message);
    return null;
  }
}

export async function deleteWatcher(id: string): Promise<boolean> {
  if (!db) return false;
  try {
    await db.delete(agentTreasuryWatchers).where(eq(agentTreasuryWatchers.id, id));
    return true;
  } catch (e: any) {
    console.warn("[watchers] delete failed", e?.message);
    return false;
  }
}

export async function recordScan(id: string, snapshot: unknown): Promise<void> {
  if (!db) return;
  try {
    await db
      .update(agentTreasuryWatchers)
      .set({ lastScanAt: new Date(), lastSnapshot: snapshot as object })
      .where(eq(agentTreasuryWatchers.id, id));
  } catch (e: any) {
    console.warn("[watchers] recordScan failed", e?.message);
  }
}

/* ───────────── scan helpers ───────────── */

export interface WatcherSnapshot {
  totalUsd: number;
  positions: Array<{ symbol?: string; contract?: string; amountUsd?: number }>;
}

async function scanEvm(w: TreasuryWatcher): Promise<WatcherSnapshot | null> {
  if (w.chain === "solana") return null;
  // Prefer Covalent (carries USD valuations); fall back to Alchemy.
  if (covalentFeed.isReady()) {
    const events = await covalentFeed.fetch({ chain: w.chain as any, address: w.address });
    const positions = events
      .filter((e) => e.kind === "chain")
      .map((e: any) => ({
        symbol: e.raw?.contract_ticker_symbol,
        contract: e.raw?.contract_address,
        amountUsd: typeof e.amountUsd === "number" ? e.amountUsd : 0,
      }));
    const totalUsd = positions.reduce((s, p) => s + (p.amountUsd || 0), 0);
    return { totalUsd, positions };
  }
  if (alchemyFeed.isReady()) {
    const events = await alchemyFeed.fetch({ chain: w.chain as any, address: w.address });
    return {
      totalUsd: 0,
      positions: events.map((e: any) => ({ contract: e.raw?.contractAddress })),
    };
  }
  return null;
}

async function scanSolana(w: TreasuryWatcher): Promise<WatcherSnapshot | null> {
  const helius = process.env.HELIUS_API_KEY;
  if (!helius) return null;
  try {
    const url = `https://mainnet.helius-rpc.com/?api-key=${helius}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dreyv-watcher",
        method: "getAssetsByOwner",
        params: { ownerAddress: w.address, page: 1, limit: 100, displayOptions: { showFungible: true } },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const items: any[] = data?.result?.items || [];
    const positions = items.slice(0, 100).map((it) => ({
      symbol: it?.content?.metadata?.symbol,
      contract: it?.id,
      amountUsd:
        typeof it?.token_info?.price_info?.total_price === "number"
          ? it.token_info.price_info.total_price
          : 0,
    }));
    const totalUsd = positions.reduce((s, p) => s + (p.amountUsd || 0), 0);
    return { totalUsd, positions };
  } catch (e: any) {
    console.warn("[watchers] solana scan failed", e?.message);
    return null;
  }
}

export async function scanWatcher(w: TreasuryWatcher): Promise<WatcherSnapshot | null> {
  if (w.chain === "solana") return scanSolana(w);
  return scanEvm(w);
}

/**
 * Compare a fresh snapshot to the previous one and decide whether to
 * surface an opportunity. Heuristic: ≥7% total-USD swing OR a new
 * position worth >5% of total appears/disappears.
 */
export function diffSnapshots(
  prev: WatcherSnapshot | null,
  next: WatcherSnapshot,
): { material: boolean; deltaPct: number; reason: string } {
  if (!prev || !prev.totalUsd) {
    return { material: false, deltaPct: 0, reason: "first_scan" };
  }
  const deltaPct = ((next.totalUsd - prev.totalUsd) / prev.totalUsd) * 100;
  if (Math.abs(deltaPct) >= 7) {
    return { material: true, deltaPct, reason: `total_usd_moved_${deltaPct.toFixed(1)}pct` };
  }
  const prevSet = new Set(prev.positions.map((p) => p.contract).filter(Boolean));
  const nextSet = new Set(next.positions.map((p) => p.contract).filter(Boolean));
  for (const p of next.positions) {
    if (p.contract && !prevSet.has(p.contract) && (p.amountUsd || 0) / next.totalUsd > 0.05) {
      return { material: true, deltaPct, reason: `new_position_${p.symbol ?? p.contract}` };
    }
  }
  for (const p of prev.positions) {
    if (p.contract && !nextSet.has(p.contract) && (p.amountUsd || 0) / (prev.totalUsd || 1) > 0.05) {
      return { material: true, deltaPct, reason: `position_exited_${p.symbol ?? p.contract}` };
    }
  }
  return { material: false, deltaPct, reason: "noise" };
}
