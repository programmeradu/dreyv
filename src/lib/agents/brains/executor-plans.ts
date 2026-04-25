/**
 * Executor plans — protocol-specific blueprints for the actions a deep-reasoning
 * proposal can request. The agent bridge (`executor-bridge.ts`) saves these
 * blueprints to `agent_tx_proposals.instructions`. At approval time, the
 * wallet-side `useTransactionExecutor` reads the blueprint and constructs the
 * concrete instructions using the user's connected wallet as `userPublicKey`.
 *
 * Why blueprints instead of pre-built instructions:
 *   - Most protocols (Marinade, Kamino, MarginFi, Jupiter) need the signer's
 *     public key baked into the instruction; we don't have that at queue time.
 *   - Quotes go stale. A swap quoted at queue time is wrong by approval time.
 *   - We want one stable, typed surface the wallet can execute regardless of
 *     which brain produced the action.
 *
 * Each builder returns a normalized `ExecutorPlan`:
 *   {
 *     protocol:  "marinade" | "kamino" | "marginfi" | "jupiter" | "spl-transfer",
 *     op:        "stake" | "unstake" | "deposit" | "withdraw" | "swap" | "rebalance" | "transfer",
 *     params:    { ...protocol-specific },
 *     mints:     string[],       // every mint involved (UI display + risk scan)
 *     summary:   string,         // human-readable one-line summary
 *     warnings:  string[],       // soft warnings the UI should surface
 *   }
 */

export type ExecutorProtocol =
  | "marinade"
  | "kamino"
  | "marginfi"
  | "jupiter"
  | "spl-transfer";

export type ExecutorOp =
  | "stake"
  | "unstake"
  | "deposit"
  | "withdraw"
  | "swap"
  | "rebalance"
  | "transfer";

export interface ExecutorPlan {
  protocol: ExecutorProtocol;
  op: ExecutorOp;
  params: Record<string, unknown>;
  mints: string[];
  summary: string;
  warnings: string[];
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeMint(token: unknown): string {
  const s = String(token ?? "").trim();
  if (!s) return "";
  // Friendly aliases the brain may have produced
  const map: Record<string, string> = {
    SOL: SOL_MINT,
    MSOL: MSOL_MINT,
    USDC: USDC_MINT,
    USDT: USDT_MINT,
  };
  return map[s.toUpperCase()] ?? s;
}

/* ───────── Marinade stake / unstake ───────── */
export function buildMarinadeStakePlan(params: Record<string, unknown>): ExecutorPlan {
  const amount = asNumber(params.amount);
  return {
    protocol: "marinade",
    op: "stake",
    params: { amountSol: amount, refCode: "dreyv" },
    mints: [SOL_MINT, MSOL_MINT],
    summary: `Stake ${amount} SOL via Marinade → mSOL`,
    warnings: amount > 1000 ? ["Large stake — slippage at unstake may apply if epoch boundary is far."] : [],
  };
}

export function buildMarinadeUnstakePlan(params: Record<string, unknown>): ExecutorPlan {
  const amount = asNumber(params.amount);
  const mode = String(params.mode ?? "delayed"); // "delayed" | "immediate"
  return {
    protocol: "marinade",
    op: "unstake",
    params: { amountMsol: amount, mode },
    mints: [MSOL_MINT, SOL_MINT],
    summary: `Unstake ${amount} mSOL via Marinade (${mode})`,
    warnings: mode === "immediate" ? ["Immediate unstake incurs a fee. Use delayed for full value."] : [],
  };
}

/* ───────── Kamino lend deposit / withdraw ───────── */
export function buildKaminoDepositPlan(params: Record<string, unknown>): ExecutorPlan {
  const mint = normalizeMint(params.token ?? params.mint);
  const amount = asNumber(params.amount);
  const market = String(params.market ?? "main");
  return {
    protocol: "kamino",
    op: "deposit",
    params: { mint, amount, market, leverage: params.leverage ?? null },
    mints: [mint],
    summary: `Deposit ${amount} ${String(params.token ?? mint).slice(0, 8)} into Kamino (${market})`,
    warnings: [],
  };
}

export function buildKaminoWithdrawPlan(params: Record<string, unknown>): ExecutorPlan {
  const mint = normalizeMint(params.token ?? params.mint);
  const amount = asNumber(params.amount);
  const market = String(params.market ?? "main");
  return {
    protocol: "kamino",
    op: "withdraw",
    params: { mint, amount, market },
    mints: [mint],
    summary: `Withdraw ${amount} ${String(params.token ?? mint).slice(0, 8)} from Kamino (${market})`,
    warnings: [],
  };
}

/* ───────── MarginFi deposit / withdraw ───────── */
export function buildMarginfiDepositPlan(params: Record<string, unknown>): ExecutorPlan {
  const mint = normalizeMint(params.token ?? params.mint);
  const amount = asNumber(params.amount);
  return {
    protocol: "marginfi",
    op: "deposit",
    params: { mint, amount, group: params.group ?? "main" },
    mints: [mint],
    summary: `Deposit ${amount} ${String(params.token ?? mint).slice(0, 8)} into MarginFi`,
    warnings: [],
  };
}

export function buildMarginfiWithdrawPlan(params: Record<string, unknown>): ExecutorPlan {
  const mint = normalizeMint(params.token ?? params.mint);
  const amount = asNumber(params.amount);
  return {
    protocol: "marginfi",
    op: "withdraw",
    params: { mint, amount, group: params.group ?? "main" },
    mints: [mint],
    summary: `Withdraw ${amount} ${String(params.token ?? mint).slice(0, 8)} from MarginFi`,
    warnings: [],
  };
}

/* ───────── Jupiter swap ───────── */
export function buildJupiterSwapPlan(params: Record<string, unknown>): ExecutorPlan {
  const inMint = normalizeMint(params.inMint ?? params.inputToken);
  const outMint = normalizeMint(params.outMint ?? params.outputToken);
  const amount = asNumber(params.amount);
  const slippageBps = asNumber(params.slippageBps, 50);
  return {
    protocol: "jupiter",
    op: "swap",
    params: { inMint, outMint, amount, slippageBps },
    mints: [inMint, outMint].filter(Boolean),
    summary: `Swap ${amount} ${String(params.inputToken ?? inMint).slice(0, 8)} → ${String(params.outputToken ?? outMint).slice(0, 8)}`,
    warnings: slippageBps > 100 ? [`Slippage ${slippageBps / 100}% is high — confirm route quality.`] : [],
  };
}

/* ───────── Rebalance — multi-leg via Jupiter routing ───────── */
export interface RebalanceTarget {
  mint: string;
  weight: number; // 0..1 target weight
}

export function buildRebalancePlan(params: Record<string, unknown>): ExecutorPlan {
  const rawTargets = Array.isArray(params.targets) ? (params.targets as RebalanceTarget[]) : [];
  const targets = rawTargets
    .map((t) => ({ mint: normalizeMint(t.mint), weight: asNumber(t.weight) }))
    .filter((t) => t.mint && t.weight > 0);
  const totalWeight = targets.reduce((s, t) => s + t.weight, 0);
  const warnings: string[] = [];
  if (totalWeight > 1.001 || totalWeight < 0.999) {
    warnings.push(`Target weights sum to ${totalWeight.toFixed(3)} — should be 1.0.`);
  }
  const slippageBps = asNumber(params.slippageBps, 75);
  return {
    protocol: "jupiter",
    op: "rebalance",
    params: { targets, slippageBps, executor: "jupiter-multi-leg" },
    mints: targets.map((t) => t.mint),
    summary: `Rebalance to ${targets.length} targets via Jupiter`,
    warnings,
  };
}

/* ───────── Generic SPL transfer (for treasury payouts) ───────── */
export function buildSplTransferPlan(params: Record<string, unknown>): ExecutorPlan {
  const mint = normalizeMint(params.token ?? params.mint);
  const amount = asNumber(params.amount);
  const to = String(params.to ?? params.recipient ?? "");
  return {
    protocol: "spl-transfer",
    op: "transfer",
    params: { mint, amount, to },
    mints: [mint],
    summary: `Transfer ${amount} ${String(params.token ?? mint).slice(0, 8)} → ${to.slice(0, 6)}…${to.slice(-4)}`,
    warnings: !to ? ["Missing recipient — proposal will fail at signing."] : [],
  };
}

/**
 * Master dispatcher. Maps a `DeepProposal` action `op` to the right plan builder.
 * Returns null when the op is `alert_only` / `spawn_subagent` (handled elsewhere)
 * or when required params are missing.
 */
export function buildPlanForAction(
  op: string,
  params: Record<string, unknown>,
): ExecutorPlan | null {
  switch (op) {
    case "swap":
      return buildJupiterSwapPlan(params);
    case "stake":
      return buildMarinadeStakePlan(params);
    case "unstake":
      return buildMarinadeUnstakePlan(params);
    case "deposit_yield": {
      const protocol = String(params.protocol ?? "kamino").toLowerCase();
      if (protocol === "marginfi") return buildMarginfiDepositPlan(params);
      return buildKaminoDepositPlan(params);
    }
    case "withdraw": {
      const protocol = String(params.protocol ?? "kamino").toLowerCase();
      if (protocol === "marginfi") return buildMarginfiWithdrawPlan(params);
      return buildKaminoWithdrawPlan(params);
    }
    case "rebalance":
      return buildRebalancePlan(params);
    case "transfer":
      return buildSplTransferPlan(params);
    default:
      return null;
  }
}
