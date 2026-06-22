/**
 * Mobile-signer handoff store.
 *
 * An unsigned tx is staged here so the user can sign it from any device
 * (desktop → phone QR, or mobile deeplink). Records expire after `ttlSec`.
 *
 * STORAGE STRATEGY
 * ────────────────
 * Production: Neon Postgres (`mcp_handoffs` table, auto-created on first use)
 * — required because Vercel serverless invocations don't share process memory,
 * so the MCP tool call (which stages the tx) and the mobile-signer GET (which
 * reads it) almost always land on different instances. An in-process Map
 * caused the "Handoff not found or expired" error in the field.
 *
 * Fallback: in-memory `globalThis` Map when `DATABASE_URL` is absent
 * (local dev without DB, tests).
 */
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export interface HandoffRecord {
  id: string;
  txBase64: string;
  userPublicKey: string;
  label: string;
  network: "solana-mainnet" | "solana-devnet";
  meta?: Record<string, unknown>;
  keyId: string;
  createdAt: number;
  expiresAt: number;
  signature?: string;
  status: "pending" | "signed" | "expired" | "rejected";
}

// ───────────────────────── in-memory fallback ─────────────────────────

type Store = Map<string, HandoffRecord>;
declare global {
  // eslint-disable-next-line no-var
  var __dreyvHandoffStore: Store | undefined;
}
function memStore(): Store {
  if (!globalThis.__dreyvHandoffStore) globalThis.__dreyvHandoffStore = new Map();
  return globalThis.__dreyvHandoffStore;
}

// ───────────────────────── postgres backend ───────────────────────────

function getSql() {
  const url = process.env.DATABASE_URL?.replace(/['"\r\n]/g, "").trim();
  if (!url) return null;
  return neon(url);
}

let _schemaReady: Promise<void> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureSchema(sql: any) {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS mcp_handoffs (
        id            text PRIMARY KEY,
        tx_base64     text NOT NULL,
        user_pubkey   text NOT NULL,
        label         text NOT NULL,
        network       text NOT NULL DEFAULT 'solana-mainnet',
        meta          jsonb,
        key_id        text NOT NULL,
        status        text NOT NULL DEFAULT 'pending',
        signature     text,
        created_at    bigint NOT NULL,
        expires_at    bigint NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS mcp_handoffs_expires_at_idx ON mcp_handoffs (expires_at)`;
  })().catch((e) => {
    _schemaReady = null;
    throw e;
  });
  return _schemaReady;
}

type Row = {
  id: string;
  tx_base64: string;
  user_pubkey: string;
  label: string;
  network: string;
  meta: Record<string, unknown> | null;
  key_id: string;
  status: string;
  signature: string | null;
  created_at: string | number;
  expires_at: string | number;
};

function rowToRecord(r: Row): HandoffRecord {
  return {
    id: r.id,
    txBase64: r.tx_base64,
    userPublicKey: r.user_pubkey,
    label: r.label,
    network: (r.network as HandoffRecord["network"]) ?? "solana-mainnet",
    meta: r.meta ?? undefined,
    keyId: r.key_id,
    status: r.status as HandoffRecord["status"],
    signature: r.signature ?? undefined,
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
  };
}

// ───────────────────────── public API ─────────────────────────────────

export async function createHandoff(args: {
  txBase64: string;
  userPublicKey: string;
  label: string;
  keyId: string;
  network?: "solana-mainnet" | "solana-devnet";
  meta?: Record<string, unknown>;
  ttlSec?: number;
}): Promise<HandoffRecord> {
  // Default TTL: 30 min (was 5 min — too short for agent loops where the user
  // takes a coffee break before signing). Records remain queryable after
  // expiry — see getHandoff — so agents can still verify status post-expiry.
  const ttlSec = args.ttlSec ?? 30 * 60;
  const id = `hf_${randomBytes(12).toString("hex")}`;
  const now = Date.now();
  const network = args.network ?? "solana-mainnet";
  const rec: HandoffRecord = {
    id,
    txBase64: args.txBase64,
    userPublicKey: args.userPublicKey,
    label: args.label,
    network,
    meta: args.meta,
    keyId: args.keyId,
    createdAt: now,
    expiresAt: now + ttlSec * 1000,
    status: "pending",
  };

  const sql = getSql();
  if (sql) {
    try {
      await ensureSchema(sql);
      // Sweep only PENDING handoffs that expired long ago (>24h). Signed and
      // rejected records are retained so agents can verify status even after
      // the signing TTL elapses.
      const sweepCutoff = now - 24 * 3600 * 1000;
      await sql`DELETE FROM mcp_handoffs WHERE status = 'pending' AND expires_at <= ${sweepCutoff}`;
      await sql`
        INSERT INTO mcp_handoffs (id, tx_base64, user_pubkey, label, network, meta, key_id, status, created_at, expires_at)
        VALUES (${id}, ${args.txBase64}, ${args.userPublicKey}, ${args.label}, ${network},
                ${args.meta ? JSON.stringify(args.meta) : null}::jsonb,
                ${args.keyId}, 'pending', ${now}, ${rec.expiresAt})
      `;
      return rec;
    } catch (e) {
      console.error("[handoff-store] insert failed, falling back to memory", e);
    }
  }
  memStore().set(id, rec);
  return rec;
}

export async function getHandoff(id: string): Promise<HandoffRecord | null> {
  const sql = getSql();
  if (sql) {
    try {
      await ensureSchema(sql);
      // Return the record regardless of expiry — callers (status endpoint,
      // intentsHandoffStatus tool) need to see signed/rejected/expired states
      // to report final outcomes to the agent. Signing endpoints enforce
      // expiry separately via the `status` and `expiresAt` fields.
      const rows = (await sql`
        SELECT id, tx_base64, user_pubkey, label, network, meta, key_id, status, signature, created_at, expires_at
        FROM mcp_handoffs
        WHERE id = ${id}
        LIMIT 1
      `) as unknown as Row[];
      if (rows.length > 0) return rowToRecord(rows[0]);
    } catch (e) {
      console.error("[handoff-store] read failed", e);
    }
  }
  const mem = memStore().get(id);
  if (!mem) return null;
  return mem;
}

export async function markHandoffSigned(
  id: string,
  signature: string,
): Promise<HandoffRecord | null> {
  const sql = getSql();
  if (sql) {
    try {
      await ensureSchema(sql);
      await sql`UPDATE mcp_handoffs SET status = 'signed', signature = ${signature} WHERE id = ${id}`;
    } catch (e) {
      console.error("[handoff-store] update failed", e);
    }
  }
  const mem = memStore().get(id);
  if (mem) {
    mem.status = "signed";
    mem.signature = signature;
  }
  return getHandoff(id);
}

export async function rejectHandoff(id: string): Promise<HandoffRecord | null> {
  const sql = getSql();
  if (sql) {
    try {
      await ensureSchema(sql);
      await sql`UPDATE mcp_handoffs SET status = 'rejected' WHERE id = ${id}`;
    } catch (e) {
      console.error("[handoff-store] reject failed", e);
    }
  }
  const mem = memStore().get(id);
  if (mem) mem.status = "rejected";
  return getHandoff(id);
}
