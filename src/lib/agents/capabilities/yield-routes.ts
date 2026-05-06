/**
 * DACS — Yield-route capabilities (CommandBar surface for treasury_yield_routes).
 *
 * Mirrors /api/treasury/yield-routes so the CommandBar can list/arm/pause/
 * resume/deploy/exit/delete a route via natural language. Every write goes
 * through DB; deploy/exit additionally enqueue an `agent_tx_proposal` (HITL).
 *
 * Capabilities:
 *   - list_yield_routes     read all routes for the active vault (live APY/balance)
 *   - arm_yield_route       flip a route to `armed` so the inflow watcher deploys on inflow
 *   - pause_yield_route     pause an active/armed route
 *   - resume_yield_route    resume a paused route
 *   - deploy_yield_route    enqueue a deposit proposal NOW (HITL signature still required)
 *   - exit_yield_route      enqueue a withdraw proposal
 *   - delete_yield_route    drop a route from the registry
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { db } from "@/db";
import { treasuryYieldRoutes } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { insertTxProposal } from "@/lib/agents/brains/storage";
import { resolveTokenMint } from "./tokens";
import { findJupiterEarnMarket, earnApyPct, buildJupiterEarnDepositTx } from "./jupiter-earn";

function notReady(operation: string, message = "Backend unavailable") {
  return { success: false as const, operation, message };
}
function needWallet(operation: string) {
  return { success: false as const, operation, message: "Connect a wallet to manage yield routes." };
}

const RPC =
  process.env.HELIUS_RPC_URL ||
  (process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : null) ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

async function fetchSolBalance(address: string): Promise<number | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json();
    const lamports = json?.result?.value;
    return typeof lamports === "number" ? lamports / 1e9 : null;
  } catch { return null; }
}

async function fetchTokenBalance(owner: string, token: string): Promise<number | null> {
  if (token.toUpperCase() === "SOL") return fetchSolBalance(owner);
  const mint = resolveTokenMint(token);
  if (!mint) return null;
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json();
    const accounts = json?.result?.value ?? [];
    return accounts.reduce((sum: number, a: any) => {
      const amt = a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      return sum + (typeof amt === "number" ? amt : 0);
    }, 0);
  } catch { return null; }
}

function activeVault(ctx: { vaultAddress?: string | null; walletAddress: string | null }): string | null {
  return ctx.vaultAddress || ctx.walletAddress || null;
}

async function findRoute(vault: string, ref: string) {
  if (!db) return null;
  // Prefer id match; fall back to fuzzy match on venue/token (case-insensitive).
  const [byId] = await db.select().from(treasuryYieldRoutes)
    .where(and(eq(treasuryYieldRoutes.id, ref), eq(treasuryYieldRoutes.vaultAddress, vault))).limit(1).catch(() => [null] as any);
  if (byId) return byId;
  const all = await db.select().from(treasuryYieldRoutes).where(eq(treasuryYieldRoutes.vaultAddress, vault));
  const lower = ref.toLowerCase();
  return all.find((r) => r.venue.toLowerCase().includes(lower) || r.token.toLowerCase() === lower) ?? null;
}

// ─── list_yield_routes ──────────────────────────────────────────────
const list_yield_routes = defineCapability({
  id: "list_yield_routes",
  domain: "yield",
  description: "List every yield route configured for the active vault, with live APY and idle balance per route. Use this whenever the user asks 'what's earning', 'show my yield routes', or 'is anything armed'.",
  inputSchema: z.object({
    statusFilter: z.enum(["all", "draft", "armed", "active", "paused", "queued", "exited"]).optional().default("all"),
  }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("list_yield_routes");
    const vault = activeVault(ctx);
    if (!vault) return needWallet("list_yield_routes");
    const rows = await db.select().from(treasuryYieldRoutes)
      .where(eq(treasuryYieldRoutes.vaultAddress, vault))
      .orderBy(desc(treasuryYieldRoutes.createdAt));
    const filtered = input.statusFilter === "all" ? rows : rows.filter((r) => r.status === input.statusFilter);

    const tokens = Array.from(new Set(filtered.map((r) => r.token)));
    const balances = await Promise.all(tokens.map(async (t) => [t, await fetchTokenBalance(vault, t)] as const));
    const balByTok = new Map(balances);
    const apyByTok = new Map<string, number>();
    await Promise.all(tokens.map(async (t) => {
      try {
        const m = await findJupiterEarnMarket(t);
        if (m) apyByTok.set(t, Math.round(earnApyPct(m) * 100));
      } catch { /* ignore */ }
    }));

    const routes = filtered.map((r) => {
      const idle = balByTok.get(r.token) ?? null;
      const liveApyBps = apyByTok.get(r.token) ?? null;
      const target = Number(r.targetAmount) || 0;
      const ready = r.status === "armed" && idle != null && idle > 0
        && (r.minApyBps == null || (liveApyBps != null && liveApyBps >= r.minApyBps));
      return {
        id: r.id,
        token: r.token,
        venue: r.venue,
        riskBand: r.riskBand,
        status: r.status,
        targetAmount: target,
        minApyBps: r.minApyBps,
        idleBalance: idle,
        liveApyBps,
        liveApyPct: liveApyBps != null ? liveApyBps / 100 : null,
        readyToDeploy: !!ready,
      };
    });

    return {
      success: true,
      operation: "list_yield_routes",
      vault,
      count: routes.length,
      routes,
      message: routes.length === 0
        ? `No yield routes configured for ${vault.slice(0, 8)}…. Use draft_yield_route to create one.`
        : `${routes.length} yield route${routes.length === 1 ? "" : "s"}: ${routes.map((r) => `${r.token}→${r.venue} (${r.status}${r.liveApyPct != null ? `, ${r.liveApyPct.toFixed(2)}% APY` : ""}${r.readyToDeploy ? ", ready" : ""})`).join("; ")}.`,
    };
  },
});

// ─── arm_yield_route ────────────────────────────────────────────────
const arm_yield_route = defineCapability({
  id: "arm_yield_route",
  domain: "yield",
  description: "Arm a yield route so the inflow watcher will draft a deposit proposal as soon as enough idle balance lands in the vault. HITL signature still required to execute.",
  inputSchema: z.object({
    route: z.string().min(1).describe("Route id, or a fuzzy match on venue/token (e.g. 'Marinade', 'USDC')."),
  }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("arm_yield_route");
    const vault = activeVault(ctx);
    if (!vault) return needWallet("arm_yield_route");
    const existing = await findRoute(vault, input.route);
    if (!existing) return { success: false, operation: "arm_yield_route", message: `No route matching "${input.route}" for vault ${vault.slice(0, 8)}…` };
    const [row] = await db.update(treasuryYieldRoutes)
      .set({ status: "armed", updatedAt: new Date() })
      .where(eq(treasuryYieldRoutes.id, existing.id)).returning();
    return {
      success: true,
      operation: "arm_yield_route",
      routeId: row?.id,
      message: `Armed ${row?.token} → ${row?.venue}. Watcher will draft a deposit proposal on the next stable inflow (HITL approval required).`,
    };
  },
});

// ─── pause_yield_route ──────────────────────────────────────────────
const pause_yield_route = defineCapability({
  id: "pause_yield_route",
  domain: "yield",
  description: "Pause a yield route so the watcher stops drafting deposits.",
  inputSchema: z.object({ route: z.string().min(1) }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("pause_yield_route");
    const vault = activeVault(ctx);
    if (!vault) return needWallet("pause_yield_route");
    const existing = await findRoute(vault, input.route);
    if (!existing) return { success: false, operation: "pause_yield_route", message: `No route matching "${input.route}".` };
    const [row] = await db.update(treasuryYieldRoutes)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(treasuryYieldRoutes.id, existing.id)).returning();
    return { success: true, operation: "pause_yield_route", routeId: row?.id, message: `Paused ${row?.token} → ${row?.venue}.` };
  },
});

// ─── resume_yield_route ─────────────────────────────────────────────
const resume_yield_route = defineCapability({
  id: "resume_yield_route",
  domain: "yield",
  description: "Resume a paused yield route. Returns it to `armed` so the watcher will deploy on next inflow.",
  inputSchema: z.object({ route: z.string().min(1) }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async (input, ctx) => {
    if (!db) return notReady("resume_yield_route");
    const vault = activeVault(ctx);
    if (!vault) return needWallet("resume_yield_route");
    const existing = await findRoute(vault, input.route);
    if (!existing) return { success: false, operation: "resume_yield_route", message: `No route matching "${input.route}".` };
    const [row] = await db.update(treasuryYieldRoutes)
      .set({ status: "armed", updatedAt: new Date() })
      .where(eq(treasuryYieldRoutes.id, existing.id)).returning();
    return { success: true, operation: "resume_yield_route", routeId: row?.id, message: `Resumed (armed) ${row?.token} → ${row?.venue}.` };
  },
});

// ─── deploy_yield_route ─────────────────────────────────────────────
const deploy_yield_route = defineCapability({
  id: "deploy_yield_route",
  domain: "yield",
  description: "Deploy a yield route NOW: enqueues a deposit proposal for HITL signature. For Jupiter Earn venues we build the actual unsigned transaction; other venues queue a generic descriptor.",
  inputSchema: z.object({
    route: z.string().min(1),
    amount: z.number().positive().optional().describe("Override amount; defaults to min(target, idle balance)."),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    if (!db) return notReady("deploy_yield_route");
    const vault = activeVault(ctx);
    if (!vault) return needWallet("deploy_yield_route");
    const route = await findRoute(vault, input.route);
    if (!route) return { success: false, operation: "deploy_yield_route", message: `No route matching "${input.route}".` };

    const idle = await fetchTokenBalance(vault, route.token);
    const target = Number(route.targetAmount) || 0;
    const requested = input.amount ?? (target > 0 ? Math.min(target, idle ?? 0) : (idle ?? 0));
    if (!idle || idle <= 0) {
      return { success: false, operation: "deploy_yield_route", message: `No idle ${route.token} in ${vault.slice(0, 8)}… to deploy.` };
    }
    const amount = Math.min(requested, idle);
    if (amount <= 0) return { success: false, operation: "deploy_yield_route", message: `Computed amount 0 — nothing to deploy.` };

    let unsignedTx: string | undefined;
    let venueTag = route.venue;
    try {
      if (/jupiter|jup\b/i.test(route.venue)) {
        const built = await buildJupiterEarnDepositTx({ token: route.token, amount, signer: vault });
        unsignedTx = built.transaction;
        venueTag = "jupiter-earn";
      }
    } catch (e) {
      // fall through to descriptor-only proposal
      console.warn("[deploy_yield_route] ix build failed, falling back to descriptor:", e);
    }

    const tx = await insertTxProposal({
      userId: route.userId,
      kind: "yield-deposit",
      summary: `Deploy ${amount.toFixed(4)} ${route.token} → ${route.venue}`,
      unsignedTx,
      instructions: [{
        type: "yield-deposit",
        venue: venueTag,
        token: route.token,
        amount,
        riskBand: route.riskBand,
        memo: `Dreyv yield route ${route.id}`,
      }],
      riskLevel: route.riskBand === "conservative" ? "low" : route.riskBand === "balanced" ? "medium" : "high",
      routing: "wallet",
      meta: { source: "commandbar-deploy-yield-route", routeId: route.id, vault },
      ttlMinutes: 120,
    });

    await db.update(treasuryYieldRoutes)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(treasuryYieldRoutes.id, route.id));

    return {
      success: true,
      operation: "deploy_yield_route",
      routeId: route.id,
      txProposalId: tx?.id ?? null,
      amount,
      token: route.token,
      venue: route.venue,
      requiresApproval: true,
      status: "READY_FOR_SIGNATURE",
      message: `Queued ${amount.toFixed(4)} ${route.token} → ${route.venue} for signature.${unsignedTx ? "" : " (Generic descriptor — venue-specific signer flow will build the ix.)"}`,
    };
  },
});

// ─── exit_yield_route ───────────────────────────────────────────────
const exit_yield_route = defineCapability({
  id: "exit_yield_route",
  domain: "yield",
  description: "Exit a yield route: enqueue a withdraw proposal for HITL signature.",
  inputSchema: z.object({
    route: z.string().min(1),
    amount: z.number().positive().optional(),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    if (!db) return notReady("exit_yield_route");
    const vault = activeVault(ctx);
    if (!vault) return needWallet("exit_yield_route");
    const route = await findRoute(vault, input.route);
    if (!route) return { success: false, operation: "exit_yield_route", message: `No route matching "${input.route}".` };
    const amount = input.amount ?? Number(route.targetAmount) ?? 0;

    const tx = await insertTxProposal({
      userId: route.userId,
      kind: "yield-withdraw",
      summary: `Exit ${amount > 0 ? amount.toFixed(4) : "all"} ${route.token} ← ${route.venue}`,
      instructions: [{
        type: "yield-withdraw",
        venue: route.venue,
        token: route.token,
        amount,
        riskBand: route.riskBand,
        memo: `Dreyv yield route ${route.id}`,
      }],
      riskLevel: "low",
      routing: "wallet",
      meta: { source: "commandbar-exit-yield-route", routeId: route.id, vault },
      ttlMinutes: 120,
    });

    await db.update(treasuryYieldRoutes)
      .set({ status: "exited", updatedAt: new Date() })
      .where(eq(treasuryYieldRoutes.id, route.id));

    return {
      success: true,
      operation: "exit_yield_route",
      routeId: route.id,
      txProposalId: tx?.id ?? null,
      requiresApproval: true,
      status: "READY_FOR_SIGNATURE",
      message: `Queued exit of ${route.token} ← ${route.venue} for signature.`,
    };
  },
});

// ─── delete_yield_route ─────────────────────────────────────────────
const delete_yield_route = defineCapability({
  id: "delete_yield_route",
  domain: "yield",
  description: "Permanently delete a yield route from the registry. Does not exit any active position; use exit_yield_route first.",
  inputSchema: z.object({ route: z.string().min(1) }),
  sideEffects: "meta",
  requiredAuth: "wallet",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    if (!db) return notReady("delete_yield_route");
    const vault = activeVault(ctx);
    if (!vault) return needWallet("delete_yield_route");
    const existing = await findRoute(vault, input.route);
    if (!existing) return { success: false, operation: "delete_yield_route", message: `No route matching "${input.route}".` };
    await db.delete(treasuryYieldRoutes).where(eq(treasuryYieldRoutes.id, existing.id));
    return { success: true, operation: "delete_yield_route", message: `Deleted ${existing.token} → ${existing.venue} from the route registry.` };
  },
});

// ─── Context summary helper (used by /api/command system prompt) ────
export async function summarizeYieldRoutesForLLM(vault: string | null | undefined): Promise<string | undefined> {
  if (!db || !vault) return undefined;
  try {
    const rows = await db.select().from(treasuryYieldRoutes)
      .where(eq(treasuryYieldRoutes.vaultAddress, vault))
      .limit(20);
    if (rows.length === 0) return undefined;
    const armed = rows.filter((r) => r.status === "armed");
    const active = rows.filter((r) => r.status === "active" || r.status === "queued");
    const parts: string[] = [];
    if (armed.length) parts.push(`${armed.length} armed (${armed.map((r) => `${r.token}→${r.venue}`).join(", ")})`);
    if (active.length) parts.push(`${active.length} active (${active.map((r) => `${r.token}→${r.venue}`).join(", ")})`);
    if (parts.length === 0) parts.push(`${rows.length} drafted`);
    return `Yield routes: ${parts.join("; ")}. Use list_yield_routes for live APY/idle balance per route; arm/pause/deploy/exit_yield_route to manage.`;
  } catch {
    return undefined;
  }
}

export const yieldRoutesCapabilities: AnyCapability[] = [
  list_yield_routes as AnyCapability,
  arm_yield_route as AnyCapability,
  pause_yield_route as AnyCapability,
  resume_yield_route as AnyCapability,
  deploy_yield_route as AnyCapability,
  exit_yield_route as AnyCapability,
  delete_yield_route as AnyCapability,
];
