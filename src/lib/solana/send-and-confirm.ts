/**
 * Centralized Solana send + confirm helper.
 *
 * Standardizes the pending → confirmed/failed lifecycle for every
 * signed transaction across the app, so we never show a green
 * "transaction sent" toast for something that silently failed
 * on-chain.
 *
 * Usage:
 *   const { signature, confirmed } = await sendAndConfirmSigned(connection, signedTx, {
 *     onPending: (sig) => toastNotifications.executionPending("Swap", sig),
 *     onConfirmed: (sig) => toastNotifications.blockchainConfirmed(sig),
 *     onError: (err, sig) => toastNotifications.executionFailed("Swap", err.message),
 *   });
 */

import type { Connection, VersionedTransaction, Transaction } from "@solana/web3.js";

export type SignedTx = Transaction | VersionedTransaction;

export interface SendAndConfirmOptions {
  /** Called as soon as the RPC accepts the transaction (we have a signature, but it's not confirmed). */
  onPending?: (signature: string) => void;
  /** Called once the transaction reaches the requested commitment. */
  onConfirmed?: (signature: string) => void;
  /** Called if either send or confirmation fails. signature may be undefined if send itself failed. */
  onError?: (error: Error, signature?: string) => void;
  /** Commitment to wait for. Defaults to "confirmed". */
  commitment?: "processed" | "confirmed" | "finalized";
  /** Pre-fetched blockhash info; if omitted we fetch our own. */
  blockhashInfo?: { blockhash: string; lastValidBlockHeight: number };
  /** When true (default), retry once with skipPreflight if preflight fails. */
  preflightFallback?: boolean;
}

export interface SendAndConfirmResult {
  signature: string;
  confirmed: boolean;
  error?: string;
}

/**
 * Serialize a signed transaction (legacy or versioned) to bytes.
 */
function serializeSigned(tx: SignedTx): Uint8Array {
  return tx.serialize() as Uint8Array;
}

/**
 * Send a pre-signed transaction and wait for confirmation.
 * Throws on send failure; returns { confirmed: false, error } on on-chain failure.
 */
export async function sendAndConfirmSigned(
  connection: Connection,
  signedTx: SignedTx,
  opts: SendAndConfirmOptions = {}
): Promise<SendAndConfirmResult> {
  const commitment = opts.commitment ?? "confirmed";
  const preflightFallback = opts.preflightFallback ?? true;

  // We need blockhash info for the proper confirmation strategy
  const blockhashInfo =
    opts.blockhashInfo ?? (await connection.getLatestBlockhash(commitment));

  const raw = serializeSigned(signedTx);

  let signature: string;
  try {
    // First attempt: with preflight (catches simulation errors before broadcast)
    signature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: commitment,
    });
  } catch (err: any) {
    // Some legitimate Jupiter routes (ALT-heavy) occasionally fail preflight.
    // Retry once with skipPreflight, but still require confirmation.
    if (preflightFallback) {
      try {
        signature = await connection.sendRawTransaction(raw, {
          skipPreflight: true,
          maxRetries: 3,
        });
      } catch (err2: any) {
        const error = new Error(err2?.message || err?.message || "Failed to send transaction");
        opts.onError?.(error);
        throw error;
      }
    } else {
      const error = new Error(err?.message || "Failed to send transaction");
      opts.onError?.(error);
      throw error;
    }
  }

  // We have a signature — surface "pending" immediately
  opts.onPending?.(signature);

  // Wait for confirmation using blockhash strategy (handles expiry correctly)
  try {
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: blockhashInfo.blockhash,
        lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
      },
      commitment
    );

    if (confirmation.value.err) {
      const errMsg = `Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`;
      const error = new Error(errMsg);
      opts.onError?.(error, signature);
      return { signature, confirmed: false, error: errMsg };
    }

    opts.onConfirmed?.(signature);
    return { signature, confirmed: true };
  } catch (err: any) {
    const error = new Error(err?.message || "Confirmation failed");
    opts.onError?.(error, signature);
    return { signature, confirmed: false, error: error.message };
  }
}

/**
 * Build a Solscan link for a signature, respecting iframe sandboxing.
 */
export function solscanUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

/**
 * Open a URL safely whether running in an iframe (Lovable preview) or standalone.
 */
export function openExternal(url: string): void {
  if (typeof window === "undefined") return;
  try {
    const isInIframe = window.self !== window.top;
    if (isInIframe) {
      window.parent.postMessage({ type: "OPEN_EXTERNAL_URL", data: { url } }, "*");
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
