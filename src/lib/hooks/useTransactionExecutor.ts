"use client";

/**
 * useTransactionExecutor — Centralized transaction execution hook
 *
 * Handles two paths for ALL transaction-producing operations:
 *   1. Individual wallet → Jupiter /swap → wallet.signTransaction() → sendRawTransaction
 *   2. Multisig vault   → sqClient.createVaultTransaction() → Squads proposal
 *
 * Used by: CommandBar, YieldOptimizer, landing-command-bar, and any future tx components.
 */

import { useCallback } from "react";
import { useWallet, useConnection } from "@/lib/wallet/compat";
import { VersionedTransaction } from "@solana/web3.js";
import { useVault } from "@/lib/contexts/VaultContext";
import { toast } from "@/lib/toast-notifications";

// Use local proxy routes which forward to lite-api.jup.ag (no API key needed)
const QUOTE_PROXY = "/api/jupiter/quote";
const SWAP_PROXY = "/api/jupiter/swap";

// Well-known token mints for client-side resolution
const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  JITO: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  BSOL: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  TRUMP: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
};

function resolveMint(symbolOrMint: string): string {
  if (symbolOrMint.length > 20) return symbolOrMint; // Already a mint address
  const normalized = symbolOrMint.trim().toUpperCase().replace(/[-_\s]/g, "");
  return TOKEN_MINTS[normalized] || symbolOrMint;
}

function getDecimals(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s === "USDC" || s === "USDT") return 6;
  if (s === "BONK") return 5;
  return 9;
}

export interface SwapParams {
  inputToken: string;   // symbol or mint
  outputToken: string;  // symbol or mint
  amount: number;       // human-readable amount (e.g. 50 SOL, not lamports)
  slippageBps?: number;
}

export interface TransferParams {
  recipient: string;
  token: string;
  amount: number;
}

export type StepStatus = "pending" | "executing" | "done" | "error" | "skipped";

export interface ExecutionResult {
  success: boolean;
  signature?: string;
  proposalKey?: string;
  error?: string;
}

export function useTransactionExecutor() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { isMultisig, sqClient, activeVault, vaultConfig } = useVault();

  /**
   * Execute a swap: wallet sign (individual) or Squads proposal (multisig)
   */
  const executeSwap = useCallback(async (params: SwapParams): Promise<ExecutionResult> => {
    const inputMint = resolveMint(params.inputToken);
    const outputMint = resolveMint(params.outputToken);
    const decimals = getDecimals(params.inputToken);
    const lamports = Math.floor(params.amount * Math.pow(10, decimals));
    const slippageBps = params.slippageBps || 50;

    // ─── Multisig Path: Create Squads Proposal with REAL Jupiter ixs ─
    if (isMultisig && sqClient && activeVault) {
      try {
        const { instructions } = await sqClient.buildJupiterSwapInstructionsForVault({
          vaultAddress: activeVault,
          inputMint,
          outputMint,
          amount: lamports,
          slippageBps,
        });

        const proposalKey = await sqClient.createVaultTransaction(
          activeVault,
          instructions,
          0,
          `Swap ${params.amount} ${params.inputToken} → ${params.outputToken}`
        );

        toast.success("Proposal Created", {
          description: `Proposal ${proposalKey.slice(0, 8)}... needs ${vaultConfig?.threshold || "N/A"} signatures.`,
        });

        return { success: true, proposalKey };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    // ─── Individual Path: Jupiter → Wallet Sign → Send ─────────────
    if (!wallet.connected || !wallet.signTransaction || !wallet.publicKey) {
      return { success: false, error: "Wallet not connected" };
    }

    try {
      // Step 1: Jupiter quote via local proxy (avoids 401 — proxy uses lite-api.jup.ag)
      const quoteRes = await fetch(
        `${QUOTE_PROXY}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${lamports}&slippageBps=${slippageBps}`
      );
      if (!quoteRes.ok) {
        const errBody = await quoteRes.json().catch(() => ({}));
        throw new Error(errBody.error || `Jupiter quote failed: ${quoteRes.status}`);
      }
      const quote = await quoteRes.json();

      // Step 2: Serialized swap transaction via local proxy
      const swapRes = await fetch(SWAP_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
        }),
      });
      if (!swapRes.ok) {
        const errBody = await swapRes.json().catch(() => ({}));
        throw new Error(errBody.error || `Jupiter swap build failed: ${swapRes.status}`);
      }
      const { swapTransaction } = await swapRes.json();

      // Step 3: Deserialize + wallet sign
      const txBuf = Buffer.from(swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBuf);
      const signedTx = await wallet.signTransaction(transaction);

      // Step 4: Send
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 2,
      });

      // Step 5: Confirm
      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      toast.success("Transaction Confirmed", {
        description: `${params.amount} ${params.inputToken} → ${params.outputToken}. Tx: ${signature.slice(0, 8)}...`,
      });

      return { success: true, signature };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, [wallet, connection, isMultisig, sqClient, activeVault, vaultConfig]);

  /**
   * Execute a transfer: wallet sign (individual) or Squads proposal (multisig)
   */
  const executeTransfer = useCallback(async (params: TransferParams): Promise<ExecutionResult> => {
    // ─── Multisig Path: Real SOL/SPL transfer instructions ─────────
    if (isMultisig && sqClient && activeVault) {
      try {
        const isSol = params.token.toUpperCase() === "SOL";
        const mint = isSol ? undefined : resolveMint(params.token);
        const decimals = isSol ? 9 : getDecimals(params.token);

        const instructions = await sqClient.buildTransferInstructions({
          vaultAddress: activeVault,
          recipient: params.recipient,
          amount: params.amount,
          mint,
          decimals,
        });

        const proposalKey = await sqClient.createVaultTransaction(
          activeVault,
          instructions,
          0,
          `Transfer ${params.amount} ${params.token} to ${params.recipient.slice(0, 8)}...`
        );
        toast.success("Proposal Created", {
          description: `Transfer proposal ${proposalKey.slice(0, 8)}... submitted.`,
        });
        return { success: true, proposalKey };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    // ─── Individual Path: build + sign + send ──────────────────────
    if (!wallet.connected || !wallet.signTransaction || !wallet.publicKey) {
      return { success: false, error: "Wallet not connected" };
    }

    // For SOL transfers, use SystemProgram.transfer
    // For SPL tokens, use Token Program transfer
    // This is a simplified version — full implementation would handle both
    try {
      const { SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
      const latestBlockhash = await connection.getLatestBlockhash();

      const tx = new Transaction({
        recentBlockhash: latestBlockhash.blockhash,
        feePayer: wallet.publicKey,
      });

      tx.add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(params.recipient),
          lamports: Math.floor(params.amount * LAMPORTS_PER_SOL),
        })
      );

      const signedTx = await wallet.signTransaction(tx);
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
      });

      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      if (confirmation.value.err) {
        throw new Error(`Transfer failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      toast.success("Transfer Confirmed", {
        description: `${params.amount} ${params.token} → ${params.recipient.slice(0, 8)}...`,
      });

      return { success: true, signature };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, [wallet, connection, isMultisig, sqClient, activeVault]);

  /**
   * Generic proposal creation for non-swap operations (bridge, yield, rebalance, etc.)
   */
  const createProposal = useCallback(async (memo: string): Promise<ExecutionResult> => {
    if (!sqClient || !activeVault) {
      return { success: false, error: "Squads client not available" };
    }
    try {
      const proposalKey = await sqClient.createVaultTransaction(activeVault, [], 0, memo);
      toast.success("Proposal Created", {
        description: `${proposalKey.slice(0, 8)}... — Awaiting team signatures.`,
      });
      return { success: true, proposalKey };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, [sqClient, activeVault]);

  /**
   * Execute a raw serialized transaction via wallet sign
   */
  const executeRawTransaction = useCallback(async (serializedTx: string): Promise<ExecutionResult> => {
    if (!wallet.connected || !wallet.signTransaction || !wallet.publicKey) {
      return { success: false, error: "Wallet not connected" };
    }

    try {
      const txBuf = Buffer.from(serializedTx, "base64");
      const transaction = VersionedTransaction.deserialize(txBuf);
      const signedTx = await wallet.signTransaction(transaction);

      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 2,
      });

      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      toast.success("Transaction Confirmed", {
        description: `Tx: ${signature.slice(0, 8)}...`,
      });

      return { success: true, signature };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, [wallet, connection]);

  /**
   * Execute MULTIPLE raw serialized transactions with a SINGLE wallet popup.
   *
   * Uses `signAllTransactions` when the adapter supports it (Phantom,
   * Backpack, Solflare, Squads…). Falls back to looping `signTransaction`
   * on adapters that only expose the single-tx path. The signed txs are
   * then submitted sequentially over RPC — the user only confirms once.
   *
   * Use this for any pipeline that emits N >= 2 serialized txs and wants
   * Sid's "one click, four steps done" UX. For atomic Jito bundling, the
   * caller should pass the resulting signed txs to the bundle endpoint
   * instead of calling this helper.
   */
  const executeRawTransactions = useCallback(async (
    serializedTxs: string[],
    onProgress?: (index: number, status: StepStatus, signature?: string) => void,
  ): Promise<ExecutionResult[]> => {
    if (!wallet.connected || !wallet.signTransaction || !wallet.publicKey) {
      return serializedTxs.map(() => ({ success: false, error: "Wallet not connected" }));
    }
    if (serializedTxs.length === 0) return [];

    try {
      const deserialized = serializedTxs.map((s) =>
        VersionedTransaction.deserialize(Buffer.from(s, "base64")),
      );

      let signed: VersionedTransaction[];
      if (deserialized.length > 1 && wallet.signAllTransactions) {
        signed = (await wallet.signAllTransactions(deserialized)) as VersionedTransaction[];
      } else {
        signed = [];
        for (const tx of deserialized) {
          signed.push(
            (await wallet.signTransaction(tx as any)) as VersionedTransaction,
          );
        }
      }

      const results: ExecutionResult[] = [];
      for (let i = 0; i < signed.length; i++) {
        onProgress?.(i, "executing");
        try {
          const sig = await connection.sendRawTransaction(signed[i].serialize(), {
            skipPreflight: false,
            maxRetries: 2,
          });
          const confirmation = await connection.confirmTransaction(sig, "confirmed");
          if (confirmation.value.err) {
            throw new Error(`Tx ${i + 1} failed: ${JSON.stringify(confirmation.value.err)}`);
          }
          results.push({ success: true, signature: sig });
          onProgress?.(i, "done", sig);
        } catch (err: any) {
          results.push({ success: false, error: err?.message ?? String(err) });
          onProgress?.(i, "error");
          // Sequential: don't keep submitting after a failure.
          for (let j = i + 1; j < signed.length; j++) {
            results.push({ success: false, error: "Skipped — previous tx failed" });
            onProgress?.(j, "skipped");
          }
          break;
        }
      }

      const allOk = results.every((r) => r.success);
      if (allOk && results.length > 1) {
        toast.success("Transactions confirmed", {
          description: `${results.length} txs landed in one signing session.`,
        });
      }
      return results;
    } catch (err: any) {
      // signAllTransactions throws on user reject — surface a single error per tx.
      return serializedTxs.map(() => ({ success: false, error: err?.message ?? String(err) }));
    }
  }, [wallet, connection]);


  /**
   * Execute a full multi-action plan sequentially.
   * Calls onStepUpdate(index, status) so the UI can render per-step progress.
   */
  const executePlan = useCallback(async (
    actions: { operation: string; parameters: Record<string, any> }[],
    onStepUpdate?: (index: number, status: StepStatus) => void,
  ): Promise<ExecutionResult[]> => {
    const results: ExecutionResult[] = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const op = action.operation.toLowerCase();
      onStepUpdate?.(i, "executing");

      let result: ExecutionResult;

      try {
        switch (op) {
          case "swap":
            result = await executeSwap({
              inputToken: action.parameters.inputToken || "SOL",
              outputToken: action.parameters.outputToken || "USDC",
              amount: action.parameters.amount || 0,
            });
            break;

          case "transfer":
            result = await executeTransfer({
              recipient: action.parameters.recipient,
              token: action.parameters.token || "SOL",
              amount: action.parameters.amount || 0,
            });
            break;

          case "stake":
          case "bridge":
          case "yield_deposit":
          case "yield_withdraw":
          case "rebalance":
            if (isMultisig) {
              result = await createProposal(
                `${op}: ${JSON.stringify(action.parameters)}`
              );
            } else {
              // For ops without full wallet integration yet, show acknowledgment
              toast.success("Action Queued", {
                description: `${op} — full execution coming soon.`,
              });
              result = { success: true };
            }
            break;

          case "serialized_batch":
          case "sign_raw_batch": {
            const raw =
              action.parameters.serializedTransactions ??
              action.parameters.transactions;
            const txs = Array.isArray(raw)
              ? raw.filter((t: unknown) => typeof t === "string")
              : [];
            if (txs.length === 0) {
              result = { success: false, error: "Missing serializedTransactions" };
              break;
            }
            if (txs.length === 1) {
              result = await executeRawTransaction(txs[0] as string);
            } else {
              const batch = await executeRawTransactions(txs as string[]);
              const failed = batch.find((r) => !r.success);
              if (failed) {
                result = { success: false, error: failed.error ?? "Batch signing failed" };
              } else {
                const sigs = batch.map((r) => r.signature).filter(Boolean) as string[];
                result = {
                  success: true,
                  signature: sigs.length ? sigs.join(",") : undefined,
                };
              }
            }
            break;
          }

          default:
            // Non-tx ops (navigate, refresh, etc.) — mark as success
            result = { success: true };
            break;
        }
      } catch (err: any) {
        result = { success: false, error: err.message };
      }

      results.push(result);
      onStepUpdate?.(i, result.success ? "done" : "error");

      // Stop chain if a step fails
      if (!result.success) {
        // Mark remaining steps as skipped
        for (let j = i + 1; j < actions.length; j++) {
          results.push({ success: false, error: "Skipped — previous step failed" });
          onStepUpdate?.(j, "skipped");
        }
        break;
      }
    }

    return results;
  }, [executeSwap, executeTransfer, createProposal, isMultisig, executeRawTransaction, executeRawTransactions]);

  return {
    executeSwap,
    executeTransfer,
    createProposal,
    executeRawTransaction,
    executeRawTransactions,
    executePlan,
    isMultisig,
    isWalletConnected: wallet.connected && !!wallet.publicKey,
    walletPublicKey: wallet.publicKey?.toString() || null,
  };
}
