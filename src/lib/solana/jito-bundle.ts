/**
 * Jito bundle helpers — tip tx builder + bundle-status poller.
 *
 * Used by CommandBar's signing flow when the envelope's bundleStrategy is
 * "atomic". The tip tx is appended to the user's signing batch so the user
 * authorizes the tip in the same wallet popup; the bundle is then submitted
 * to /api/solana/jito-bundle (max 5 txs).
 *
 * Jito tip accounts are well-known and rotated by Jito. Pinning a small set
 * here is fine for now; if a tx happens to use a stale one, Jito just rejects
 * the bundle and the wrapper falls back to sequential RPC submission.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";

const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pivKeVBBjNo1f5ENxDD",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

/**
 * Default tip floor (lamports). Set NEXT_PUBLIC_JITO_TIP_LAMPORTS to override.
 * 50_000 lamports ≈ $0.005 at SOL=$100 — high enough to land most blocks
 * during normal congestion, low enough that retail flows aren't taxed.
 */
const DEFAULT_TIP_LAMPORTS = 50_000;

export function pickJitoTipAccount(): string {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

export function getJitoTipLamports(): number {
  if (typeof process !== "undefined") {
    const raw = process.env.NEXT_PUBLIC_JITO_TIP_LAMPORTS;
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return DEFAULT_TIP_LAMPORTS;
}

/**
 * Build a one-instruction tip tx the user signs alongside the rest of the
 * bundle. Uses a fresh blockhash so it lands in the same window as the
 * other signed txs.
 */
export async function buildJitoTipTx(opts: {
  connection: Connection;
  payer: PublicKey;
  blockhash: string;
  tipLamports?: number;
}): Promise<{ tx: VersionedTransaction; tipAccount: string; tipLamports: number }> {
  const tipAccount = pickJitoTipAccount();
  const tipLamports = opts.tipLamports ?? getJitoTipLamports();
  const message = new TransactionMessage({
    payerKey: opts.payer,
    recentBlockhash: opts.blockhash,
    instructions: [
      // Cheap CU limit — this tx is just a transfer.
      ComputeBudgetProgram.setComputeUnitLimit({ units: 5_000 }),
      SystemProgram.transfer({
        fromPubkey: opts.payer,
        toPubkey: new PublicKey(tipAccount),
        lamports: tipLamports,
      }),
    ],
  }).compileToV0Message();
  return { tx: new VersionedTransaction(message), tipAccount, tipLamports };
}

export interface BundleStatusResult {
  state: "pending" | "landed" | "failed" | "unknown";
  signatures: string[];
  slot?: number;
  error?: string;
}

/**
 * Poll Jito's getBundleStatuses until the bundle either lands or we time out.
 * The bundleId is what /api/solana/jito-bundle returns on success.
 */
export async function pollJitoBundleStatus(
  bundleId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<BundleStatusResult> {
  const intervalMs = opts.intervalMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  // Use the same regional endpoints as the submit route. Block engine
  // accepts getBundleStatuses on the same /bundles path.
  const endpoint = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

  while (Date.now() < deadline) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBundleStatuses",
          params: [[bundleId]],
        }),
      });
      const json = await res.json();
      const value = json?.result?.value?.[0];
      if (value) {
        const sigs: string[] = Array.isArray(value.transactions) ? value.transactions : [];
        const status: string | undefined =
          value.confirmation_status ?? value.confirmationStatus;
        if (value.err && (value.err.Ok === undefined || value.err.Ok === null)) {
          return {
            state: "failed",
            signatures: sigs,
            slot: value.slot,
            error: typeof value.err === "string" ? value.err : JSON.stringify(value.err),
          };
        }
        if (status === "finalized" || status === "confirmed" || status === "processed") {
          return { state: "landed", signatures: sigs, slot: value.slot };
        }
      }
    } catch {
      // Transient — keep polling.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { state: "unknown", signatures: [], error: "timeout" };
}
