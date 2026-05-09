/**
 * Watcher / cross-chain monitor capabilities.
 *
 * Lets the agent actually create the (chain, address) monitors it claims to
 * create when a user says "watch this address" or "add this EVM vault".
 * Without these, the LLM happily promises to add a watcher and nothing
 * lands in the DB → empty inbox/treasury panels.
 *
 *   - add_address_watcher   → POST /api/inbox/watchers
 *   - list_address_watchers → GET  /api/inbox/watchers
 *   - remove_address_watcher → DELETE /api/inbox/watchers
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { getSiteOrigin } from "@/lib/seo/site";

const VALID_CHAINS = ["solana", "ethereum", "base", "arbitrum", "polygon", "bsc"] as const;
type WatcherChain = (typeof VALID_CHAINS)[number];

const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;

function inferChain(addr: string): WatcherChain | null {
  if (EVM_ADDR.test(addr)) return "ethereum";
  if (SOLANA_ADDR.test(addr)) return "solana";
  return null;
}

const add_address_watcher = defineCapability({
  id: "add_address_watcher",
  domain: "treasury",
  description:
    "Persist a (chain, address) treasury watcher for the connected user. Use this whenever the user says 'watch this address', 'add this wallet/vault', or pastes an EVM/Solana address they want monitored. Creates a row the inbox/treasury panels read from; without it, claiming to 'add a watcher' is a hallucination.",
  inputSchema: z.object({
    address: z.string().min(20).describe("The external address to watch (Solana base58 or EVM 0x hex)."),
    chain: z
      .enum(VALID_CHAINS)
      .optional()
      .describe("Chain key. Inferred from the address shape when omitted."),
    label: z.string().max(80).optional().describe("Optional human label, e.g. 'Ops vault'."),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "low",
  supportedChains: ["solana", "evm"],
  execute: async (input, ctx) => {
    const walletAddress = ctx.walletAddress;
    if (!walletAddress) {
      return {
        success: false,
        operation: "add_address_watcher",
        message: "No connected wallet on context — user must sign in first.",
      };
    }
    const address = input.address.trim();
    const chain = input.chain ?? inferChain(address);
    if (!chain) {
      return {
        success: false,
        operation: "add_address_watcher",
        message: "Could not infer chain from address; provide an explicit chain.",
      };
    }
    const res = await fetch(`${getSiteOrigin()}/api/inbox/watchers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress,
        chain,
        address: chain === "solana" ? address : address.toLowerCase(),
        label: input.label,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        success: false,
        operation: "add_address_watcher",
        message: `Watcher endpoint returned ${res.status}.`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; watcher?: unknown };
    return {
      success: !!data.ok,
      operation: "add_address_watcher",
      chain,
      address,
      watcher: data.watcher ?? null,
      message: data.ok
        ? `Watcher created for ${chain}:${address.slice(0, 8)}…. Findings will surface in your inbox within minutes.`
        : "Watcher upsert failed.",
    };
  },
});

const list_address_watchers = defineCapability({
  id: "list_address_watchers",
  domain: "treasury",
  description:
    "List existing treasury watchers for the connected user across Solana and EVM chains.",
  inputSchema: z.object({}),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  supportedChains: ["solana", "evm"],
  execute: async (_input, ctx) => {
    const walletAddress = ctx.walletAddress;
    if (!walletAddress) {
      return {
        success: false,
        operation: "list_address_watchers",
        message: "No connected wallet on context.",
      };
    }
    const res = await fetch(
      `${getSiteOrigin()}/api/inbox/watchers?wallet=${encodeURIComponent(walletAddress)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return {
        success: false,
        operation: "list_address_watchers",
        message: `Watcher endpoint returned ${res.status}.`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      watchers?: Array<{ id: string; chain: string; address: string; label?: string | null }>;
    };
    const watchers = data.watchers ?? [];
    return {
      success: true,
      operation: "list_address_watchers",
      count: watchers.length,
      watchers,
    };
  },
});

const remove_address_watcher = defineCapability({
  id: "remove_address_watcher",
  domain: "treasury",
  description: "Delete a treasury watcher by id.",
  inputSchema: z.object({
    id: z.string().min(1).describe("Watcher row id (from list_address_watchers)."),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "low",
  supportedChains: ["solana", "evm"],
  execute: async (input) => {
    const res = await fetch(
      `${getSiteOrigin()}/api/inbox/watchers?id=${encodeURIComponent(input.id)}`,
      { method: "DELETE", cache: "no-store" },
    );
    if (!res.ok) {
      return {
        success: false,
        operation: "remove_address_watcher",
        message: `Watcher endpoint returned ${res.status}.`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return {
      success: !!data.ok,
      operation: "remove_address_watcher",
      id: input.id,
    };
  },
});

export const watcherCapabilities: AnyCapability[] = [
  add_address_watcher,
  list_address_watchers,
  remove_address_watcher,
];
