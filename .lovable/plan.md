

## Harden the Simulation Firewall — strip stubs, enforce real checks

The previous pass left mock paths and "best-effort" gaps in the firewall. The user wants every transactional path to fail-closed through real RPC simulation + a strict policy engine. No mocks, no fallbacks.

### What's wrong today

1. `src/lib/studio/simulation-firewall.ts`
   - `mockSimulation()` returns hardcoded SOL/USDC balance changes when the tx can't be deserialized → silent pass for unparseable input.
   - `extractBalanceChangesFromLogs()` is a regex hack that misses 99% of real instructions.
   - `estimatedFee` is hardcoded `0.000005` instead of `getFeeForMessage`.
   - On RPC error → returns `success:false` but assigns `riskLevel: critical` with no policy gate.
2. `src/lib/firewall/policy.ts` — does not exist (previous claim was wrong).
3. `src/lib/actions.ts`
   - `executeSwap` / `executeTransfer` use `mockInstructions` (`Buffer.from([])`) — no real instruction deserialization, so the firewall never sees a true tx.
   - Catch-block fallback in `executeSwap` swallows Jupiter errors and substitutes a mock — must throw instead.
   - "Pre-check" only validates parameter presence; never runs `simulationFirewall.simulate()`.
4. `src/app/api/firewall/check/route.ts` — referenced in last summary, needs verification/creation.

### Fixes

**A. Create real policy engine** — `src/lib/firewall/policy.ts`
```ts
export interface FirewallPolicy {
  maxPriceImpactPct: number;     // 1.0
  maxSlippageBps: number;        // 100
  maxTxFeeSol: number;           // 0.01
  maxNotionalUsd: number;        // 50_000
  blockedPrograms: Set<string>;  // known drainers
  requireSimulation: true;       // always
  requireBalanceDiff: true;      // pre/post account snapshots required
}
export const DEFAULT_POLICY: FirewallPolicy;
export class FirewallBlockedError extends Error { violations: string[]; riskLevel: string; }
export function evaluate(report, simResult, policy): { passed; violations[]; riskLevel } // throws FirewallBlockedError if !passed
```

**B. Harden `simulation-firewall.ts`** (rewrite, no stubs)
- **Delete** `mockSimulation()` and the `extractBalanceChangesFromLogs()` regex.
- `simulate()` accepts only `Transaction | VersionedTransaction | base64 string | Uint8Array`. Anything else → throw `FirewallBlockedError("Unparseable transaction")`. No silent pass.
- Call `connection.simulateTransaction(tx, { sigVerify:false, replaceRecentBlockhash:true, accounts:{ encoding:"base64", addresses:[...writableAccountKeys] }, commitment:"confirmed" })` to get **real pre/post account state**.
- Compute real lamport deltas + SPL token deltas from `accounts` array (parse SPL token account layout for owner === signer).
- Compute real fee via `connection.getFeeForMessage(message)`.
- On `result.err` → throw `FirewallBlockedError` with the program error.
- On any RPC failure → throw, never return a passing result.
- `protect()` (quote pre-flight): keep but tighten — `priceImpact > policy.maxPriceImpactPct` → fail (was `>5` cosmetic), missing `routePlan` → fail, missing `outAmountWithSlippage` → fail (not warn).

**C. Fix `actions.ts` to actually build + simulate real txs**
- Remove the `mockInstructions` placeholder in `executeSwap` and `executeTransfer`.
- `executeSwap`: deserialize Jupiter `swapInstruction` (base64 `data`, accounts) into real `TransactionInstruction` objects via `instructionDataToTransactionInstruction` helper. If Jupiter fetch fails → throw, no mock fallback.
- For each tx-producing op (`swap`, `transfer`, `stake`, `bridge`, `yield_deposit`, `yield_withdraw`):
  1. Build real instructions (or throw).
  2. Compose `VersionedTransaction` against vault pubkey + recent blockhash.
  3. `simulationFirewall.protect(quote)` (when quote available) → throw on fail.
  4. `simulationFirewall.simulate(tx, signer)` → throw on fail.
  5. `evaluate(report, simResult, DEFAULT_POLICY)` → throw on policy violation.
  6. Only then submit to Squads / wallet.
- Attach `{ firewallReport, simResult }` to the returned action result.

**D. Verify/create `src/app/api/firewall/check/route.ts`**
- POST `{ quote?, serializedTx?, signer }` → runs `protect` + `simulate` + `evaluate`, returns full report. Returns 400 with violations on block.

**E. Coordinator** — `src/lib/agents/coordinator.ts`
- After `executeSwap` builds the real tx (post Jupiter `/swap`), call `simulate()` + `evaluate()` before serializing back to the user. Mirror in `executeRebalance`, `executeStake`, `executeDCA`.

**F. Tests** — `src/lib/firewall/policy.test.ts`
- Quote with 7% price impact → blocked.
- Quote missing routePlan → blocked.
- Fee > 0.01 SOL → blocked.
- Tx with `result.err` → blocked.
- Unparseable tx → blocked (was silently passing via mock).
- Clean swap (0.1% impact, 0.000005 SOL fee) → passes with `riskLevel: low`.

### Files

**New:** `src/lib/firewall/policy.ts`, `src/lib/firewall/policy.test.ts`, `src/lib/firewall/instruction-deserializer.ts` (Jupiter base64 → `TransactionInstruction`)

**Rewritten:** `src/lib/studio/simulation-firewall.ts` (mocks deleted), `src/lib/actions.ts` (`executeSwap`/`executeTransfer` real instructions + firewall gate)

**Edited:** `src/lib/agents/coordinator.ts` (post-build simulate + evaluate), `src/app/api/firewall/check/route.ts` (verify exists; create if not)

### Acceptance
- `grep -rn "mockSimulation\|mockInstructions\|extractBalanceChangesFromLogs" src/` returns zero hits.
- Unparseable tx → `FirewallBlockedError`, never a passing `SimulationResult`.
- Real Jupiter swap tx shows actual lamport/SPL deltas in `balanceChanges`, real fee from `getFeeForMessage`.
- Swap with `priceImpactPct > 1` is blocked end-to-end (CommandBar surfaces `humanSummary` + violations).
- All policy tests green.

