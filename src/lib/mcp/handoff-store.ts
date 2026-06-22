/**
 * Mobile-signer handoff store.
 *
 * An unsigned tx is staged here so the user can sign it from any device
 * (desktop → phone QR, or mobile deeplink). Records expire after `ttlSec`.
 *
 * STORAGE STRATEGY
 * ────────────────
 * We use a process-local Map keyed under globalThis so HMR + Next.js route
 * caching don't lose entries. For multi-instance / serverless production,
 * back this with `mcp_handoffs` in Postgres (migration TODO) — the public
 * API surface stays identical, just swap the impl.
 */
import { randomBytes } from "node:crypto";

export interface HandoffRecord {
  id: string;
  txBase64: string;
  userPublicKey: string;
  label: string;
  network: "solana-mainnet" | "solana-devnet";
  /** Optional meta surfaced to the mobile signer UI. */
  meta?: Record<string, unknown>;
  /** Owner — the API-key id that staged this handoff. */
  keyId: string;
  createdAt: number;
  expiresAt: number;
  /** Set after the user signs + broadcasts. */
  signature?: string;
  status: "pending" | "signed" | "expired" | "rejected";
}

type Store = Map<string, HandoffRecord>;

declare global {
  // eslint-disable-next-line no-var
  var __dreyvHandoffStore: Store | undefined;
}

function store(): Store {
  if (!globalThis.__dreyvHandoffStore) globalThis.__dreyvHandoffStore = new Map();
  return globalThis.__dreyvHandoffStore;
}

function sweep() {
  const now = Date.now();
  const s = store();
  for (const [id, rec] of s) {
    if (rec.expiresAt <= now) s.delete(id);
  }
}

export function createHandoff(args: {
  txBase64: string;
  userPublicKey: string;
  label: string;
  keyId: string;
  network?: "solana-mainnet" | "solana-devnet";
  meta?: Record<string, unknown>;
  ttlSec?: number;
}): HandoffRecord {
  sweep();
  const ttlSec = args.ttlSec ?? 5 * 60;
  const id = `hf_${randomBytes(12).toString("hex")}`;
  const now = Date.now();
  const rec: HandoffRecord = {
    id,
    txBase64: args.txBase64,
    userPublicKey: args.userPublicKey,
    label: args.label,
    network: args.network ?? "solana-mainnet",
    meta: args.meta,
    keyId: args.keyId,
    createdAt: now,
    expiresAt: now + ttlSec * 1000,
    status: "pending",
  };
  store().set(id, rec);
  return rec;
}

export function getHandoff(id: string): HandoffRecord | null {
  sweep();
  return store().get(id) ?? null;
}

export function markHandoffSigned(id: string, signature: string): HandoffRecord | null {
  const rec = getHandoff(id);
  if (!rec) return null;
  rec.status = "signed";
  rec.signature = signature;
  return rec;
}

export function rejectHandoff(id: string): HandoffRecord | null {
  const rec = getHandoff(id);
  if (!rec) return null;
  rec.status = "rejected";
  return rec;
}
