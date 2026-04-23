/**
 * poll-confirmation — polls Solana RPC for a signature's terminal status.
 *
 * The wallet executor's `confirmTransaction` is a one-shot await on the
 * websocket. In an HITL inbox we want to *re-verify* the on-chain outcome
 * before flipping the server-side row to `confirmed`, so that:
 *   - dropped/expired txs surface as `failed`, not silently confirmed
 *   - a transient WS hiccup doesn't lose us the result
 *
 * Returns:
 *   { confirmed: true }                     — landed, no on-chain error
 *   { confirmed: false, error: "..."  }     — landed but failed, or never landed
 *   { confirmed: false, error: "timeout" }  — no status after maxWaitMs
 */
import { Connection } from "@solana/web3.js";

export interface PollResult {
  confirmed: boolean;
  error?: string;
  slot?: number;
}

export async function pollConfirmation(
  connection: Connection,
  signature: string,
  opts: { maxWaitMs?: number; intervalMs?: number } = {},
): Promise<PollResult> {
  const maxWaitMs = opts.maxWaitMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const res = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = res?.value?.[0];
      if (status) {
        if (status.err) {
          return { confirmed: false, error: JSON.stringify(status.err).slice(0, 300), slot: status.slot };
        }
        if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
        ) {
          return { confirmed: true, slot: status.slot };
        }
      }
    } catch {
      // swallow transient RPC errors and keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { confirmed: false, error: "timeout" };
}
