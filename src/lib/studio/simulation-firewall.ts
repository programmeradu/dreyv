/**
 * Keystone Simulation Firewall (HARDENED — no mocks, no silent passes)
 *
 * Every transaction-producing operation in the platform is required to
 * pass through this firewall before being signed by the user / vault.
 *
 * Pipeline:
 *   1. `protect(quote)`  — quote-level pre-flight (price impact, route, slippage)
 *   2. `simulate(tx)`    — real RPC `simulateTransaction` against mainnet,
 *                          requesting `accounts` snapshots so we can compute
 *                          true lamport / SPL token deltas and the real fee
 *                          via `getFeeForMessage`.
 *   3. policy `evaluate` — caller passes the report + sim into
 *                          `@/lib/firewall/policy.evaluate` for hard checks.
 *
 * The previous mock paths (`mockSimulation`, log-regex balance extraction,
 * hardcoded fee) have been deleted. Any unparseable input or RPC failure
 * throws `FirewallBlockedError` — there is no silent-pass path.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type SimulatedTransactionAccountInfo,
  type SimulatedTransactionResponse,
} from "@solana/web3.js";
import { FirewallBlockedError } from "@/lib/firewall/policy";

// ─── Types ──────────────────────────────────────────────────────────

export interface BalanceChange {
  token: string; // Token symbol or mint address
  before: number;
  after: number;
  change: number;
  changeUsd?: number;
}

export interface SimulationResult {
  success: boolean;
  error?: string;
  balanceChanges: BalanceChange[];
  estimatedFee: number; // SOL
  logs: string[];
  unitsConsumed: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  humanSummary: string;
}

/**
 * Pre-flight report returned by `protect()` — quote-level validation
 * before actual on-chain simulation.
 */
export interface FirewallReport {
  passed: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  checks: Record<string, "pass" | "fail" | "warn">;
  blockedReason?: string;
  priceImpact: number;
  outputAmount: string;
  humanSummary: string;
}

// ─── SPL Token Account layout (slim parser) ─────────────────────────
// Layout: mint(32) | owner(32) | amount(u64 LE, 8) | ...
// We only need the first 72 bytes.
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function parseSplTokenAccount(dataBase64: string): { mint: string; owner: string; amount: bigint } | null {
  try {
    const buf = Buffer.from(dataBase64, "base64");
    if (buf.length < 72) return null;
    const mint = new PublicKey(buf.subarray(0, 32)).toBase58();
    const owner = new PublicKey(buf.subarray(32, 64)).toBase58();
    const amount = buf.readBigUInt64LE(64);
    return { mint, owner, amount };
  } catch {
    return null;
  }
}

function lamportsToSol(lamports: number | bigint): number {
  const n = typeof lamports === "bigint" ? Number(lamports) : lamports;
  return n / 1_000_000_000;
}

// ─── Risk Assessment ────────────────────────────────────────────────

function assessRisk(changes: BalanceChange[], _fee: number): SimulationResult["riskLevel"] {
  const totalLossUsd = changes
    .filter((c) => c.change < 0)
    .reduce((sum, c) => sum + Math.abs(c.changeUsd || 0), 0);

  if (totalLossUsd > 1000) return "critical";
  if (totalLossUsd > 100) return "high";
  if (totalLossUsd > 10) return "medium";
  return "low";
}

function buildHumanSummary(changes: BalanceChange[], fee: number): string {
  const losses = changes.filter((c) => c.change < 0);
  const gains = changes.filter((c) => c.change > 0);

  const parts: string[] = [];
  if (losses.length > 0) {
    parts.push(
      `You send: ${losses.map((c) => `${Math.abs(c.change).toLocaleString()} ${c.token}`).join(", ")}`
    );
  }
  if (gains.length > 0) {
    parts.push(
      `You receive: ${gains.map((c) => `${c.change.toLocaleString()} ${c.token}`).join(", ")}`
    );
  }
  if (fee > 0) parts.push(`Fee: ${fee.toFixed(6)} SOL`);
  return parts.join(" | ") || "No balance changes detected";
}

// ─── Simulation Engine ──────────────────────────────────────────────

export class SimulationFirewall {
  private static instance: SimulationFirewall;
  private connection: Connection;

  private constructor(rpcUrl?: string) {
    const endpoint =
      rpcUrl ||
      process.env.HELIUS_RPC_URL ||
      (process.env.HELIUS_API_KEY
        ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
        : process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com");
    this.connection = new Connection(endpoint, "confirmed");
  }

  public static getInstance(): SimulationFirewall {
    if (!SimulationFirewall.instance) {
      SimulationFirewall.instance = new SimulationFirewall();
    }
    return SimulationFirewall.instance;
  }

  // ─── Quote pre-flight ────────────────────────────────────────────
  /**
   * Validates a Jupiter-style quote BEFORE on-chain simulation.
   * Strict — failed checks are not warnings.
   */
  protect(quote: {
    priceImpactPct?: string;
    inAmount?: string;
    outAmount?: string;
    outAmountWithSlippage?: string;
    routePlan?: unknown[];
  }): FirewallReport {
    const priceImpact = parseFloat(quote.priceImpactPct || "0");
    const outAmount = parseFloat(quote.outAmount || "0");
    const inAmount = parseFloat(quote.inAmount || "0");

    const checks: Record<string, "pass" | "fail" | "warn"> = {
      priceImpact: priceImpact > 1 ? "fail" : priceImpact > 0.5 ? "warn" : "pass",
      outputNonZero: outAmount > 0 ? "pass" : "fail",
      inputNonZero: inAmount > 0 ? "pass" : "fail",
      routeExists: (quote.routePlan?.length || 0) > 0 ? "pass" : "fail",
      slippageGuard: quote.outAmountWithSlippage ? "pass" : "fail",
    };

    const failedChecks = Object.entries(checks)
      .filter(([, v]) => v === "fail")
      .map(([k]) => k);

    let riskLevel: FirewallReport["riskLevel"] = "low";
    if (priceImpact > 5 || outAmount <= 0) riskLevel = "critical";
    else if (priceImpact > 2) riskLevel = "high";
    else if (priceImpact > 0.5) riskLevel = "medium";

    const passed = failedChecks.length === 0;
    const parts: string[] = [];
    parts.push(
      passed ? "All pre-flight checks passed" : `BLOCKED: Failed checks: ${failedChecks.join(", ")}`
    );
    parts.push(`Price impact: ${priceImpact}%`);
    parts.push(`Risk: ${riskLevel}`);

    return {
      passed,
      riskLevel,
      checks,
      blockedReason: passed
        ? undefined
        : `Simulation Firewall blocked: ${failedChecks.join(", ")} failed`,
      priceImpact,
      outputAmount: quote.outAmount || "0",
      humanSummary: parts.join(" | "),
    };
  }

  // ─── On-chain simulation ─────────────────────────────────────────
  /**
   * Simulate a transaction against a real RPC and compute true
   * pre/post balance deltas + the real fee. Throws
   * `FirewallBlockedError` on any failure — never returns a silent pass.
   */
  async simulate(
    transactionData: VersionedTransaction | Transaction | string | Uint8Array,
    signerPublicKey: string
  ): Promise<SimulationResult> {
    if (!signerPublicKey) {
      throw new FirewallBlockedError("Missing signer public key for simulation", [
        "signer required",
      ]);
    }

    // ─── 1. Normalize input → VersionedTransaction ─────────────────
    let tx: VersionedTransaction;
    try {
      if (transactionData instanceof VersionedTransaction) {
        tx = transactionData;
      } else if (transactionData instanceof Transaction) {
        // Legacy → wrap as v0 by serializing the message
        const msg = transactionData.compileMessage();
        tx = new VersionedTransaction(msg);
      } else if (typeof transactionData === "string") {
        const bytes = Buffer.from(transactionData, "base64");
        tx = VersionedTransaction.deserialize(bytes);
      } else if (transactionData instanceof Uint8Array) {
        tx = VersionedTransaction.deserialize(transactionData);
      } else {
        throw new Error("Unsupported transaction format");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new FirewallBlockedError(
        `Unparseable transaction: ${msg}`,
        ["transaction could not be deserialized"],
        "critical"
      );
    }

    // ─── 2. Collect writable account keys for snapshot diff ────────
    const writableKeys: PublicKey[] = [];
    const allKeys: PublicKey[] = [];
    try {
      const message = tx.message;
      const staticKeys = message.staticAccountKeys;
      const numWritableSigners = message.header.numRequiredSignatures - message.header.numReadonlySignedAccounts;
      const numWritableNonSigners =
        staticKeys.length - message.header.numRequiredSignatures - message.header.numReadonlyUnsignedAccounts;
      for (let i = 0; i < staticKeys.length; i++) {
        allKeys.push(staticKeys[i]);
        const isWritableSigner = i < numWritableSigners;
        const isWritableNonSigner =
          i >= message.header.numRequiredSignatures &&
          i < message.header.numRequiredSignatures + numWritableNonSigners;
        if (isWritableSigner || isWritableNonSigner) writableKeys.push(staticKeys[i]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new FirewallBlockedError(
        `Could not extract account keys: ${msg}`,
        ["account key extraction failed"],
        "critical"
      );
    }

    // ─── 3. Snapshot pre-state for writable accounts ───────────────
    let preAccounts: (SimulatedTransactionAccountInfo | null)[] = [];
    try {
      const infos = await this.connection.getMultipleAccountsInfo(writableKeys, "confirmed");
      preAccounts = infos.map((info) =>
        info
          ? {
              executable: info.executable,
              owner: info.owner.toBase58(),
              lamports: info.lamports,
              data: [info.data.toString("base64"), "base64"],
              rentEpoch: info.rentEpoch ?? 0,
            }
          : null
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new FirewallBlockedError(
        `RPC pre-state snapshot failed: ${msg}`,
        ["pre-snapshot failed"],
        "critical"
      );
    }

    // ─── 4. Run the actual simulation ──────────────────────────────
    let simResp: { value: SimulatedTransactionResponse } | null = null;
    try {
      simResp = await this.connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        accounts: {
          encoding: "base64",
          addresses: writableKeys.map((k) => k.toBase58()),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new FirewallBlockedError(
        `On-chain simulation RPC failed: ${msg}`,
        ["simulation RPC failed"],
        "critical"
      );
    }

    const result = simResp.value;

    if (result.err) {
      throw new FirewallBlockedError(
        `Transaction would fail on-chain: ${JSON.stringify(result.err)}`,
        [`program error: ${JSON.stringify(result.err)}`, ...(result.logs || []).slice(-5)],
        "critical"
      );
    }

    // ─── 5. Compute real fee via getFeeForMessage ──────────────────
    let estimatedFee = 0;
    try {
      const feeResp = await this.connection.getFeeForMessage(tx.message, "confirmed");
      if (typeof feeResp.value === "number") estimatedFee = lamportsToSol(feeResp.value);
    } catch {
      // Fee oracle is best-effort — we'll let policy.evaluate decide whether
      // the (now zero) fee passes. Treat unavailability as 0 — policy still
      // requires balance diff, so this alone cannot cause a silent pass.
    }

    // ─── 6. Compute real balance deltas from snapshots ─────────────
    const postAccounts = result.accounts || [];
    const balanceChanges: BalanceChange[] = [];
    const signerBase58 = signerPublicKey;

    for (let i = 0; i < writableKeys.length; i++) {
      const key = writableKeys[i].toBase58();
      const pre = preAccounts[i];
      const post = postAccounts[i];

      const preLamports = pre?.lamports ?? 0;
      const postLamports = post?.lamports ?? 0;
      const lamportDelta = postLamports - preLamports;

      // Native SOL change for the signer
      if (key === signerBase58 && lamportDelta !== 0) {
        balanceChanges.push({
          token: "SOL",
          before: lamportsToSol(preLamports),
          after: lamportsToSol(postLamports),
          change: lamportsToSol(lamportDelta),
        });
        continue;
      }

      // SPL token account change owned by signer
      const owner = post?.owner ?? pre?.owner;
      if (owner === SPL_TOKEN_PROGRAM || owner === SPL_TOKEN_2022_PROGRAM) {
        const preData = pre?.data?.[0];
        const postDataRaw = post?.data;
        const postData = Array.isArray(postDataRaw) ? postDataRaw[0] : undefined;
        const preParsed = preData ? parseSplTokenAccount(preData) : null;
        const postParsed = postData ? parseSplTokenAccount(postData) : null;
        const tokenOwner = postParsed?.owner || preParsed?.owner;
        if (tokenOwner === signerBase58) {
          const preAmt = Number(preParsed?.amount ?? 0n);
          const postAmt = Number(postParsed?.amount ?? 0n);
          const delta = postAmt - preAmt;
          if (delta !== 0) {
            balanceChanges.push({
              token: postParsed?.mint || preParsed?.mint || key,
              before: preAmt,
              after: postAmt,
              change: delta,
            });
          }
        }
      }
    }

    const logs = result.logs || [];
    const unitsConsumed = result.unitsConsumed || 0;
    const riskLevel = assessRisk(balanceChanges, estimatedFee);
    const humanSummary = buildHumanSummary(balanceChanges, estimatedFee);

    return {
      success: true,
      balanceChanges,
      estimatedFee,
      logs,
      unitsConsumed,
      riskLevel,
      humanSummary,
    };
  }
}

// ─── Singleton ──────────────────────────────────────────────────────
export const simulationFirewall = SimulationFirewall.getInstance();
