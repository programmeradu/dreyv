

## Investigation summary

**1. Hardcoded swap tokens (`JupiterSwapCard.tsx`)**
The Atlas swap widget only seeds Jupiter with two mints — SOL (`So111…`) and USDC (`EPjF…`) — via `formProps.initialInputMint/initialOutputMint`. Jupiter's plugin technically lets users pick any token from its internal list, but we never expose a curated set, never persist the user's last pair, and never accept tokens from URL/portfolio context. So in practice it feels like a 2-token swap.

**2. False-positive transactions**
Several execution paths fire success toasts that don't reflect on-chain reality:

- `atlas-client.tsx` `executeSwap/executeStake/executeLp` → calls `sendRawTransaction(..., { skipPreflight: true })` then **immediately** toasts "Transaction sent" and shows a Solscan link. It never calls `confirmTransaction`. If the tx silently fails on-chain (insufficient SOL for fees, slippage, expired blockhash, ALT issue), the user sees a green success + a "view on Solscan" link to a dead signature.
- `AgentExecutor.tsx` and `AgentDashboard.tsx` fire `toastNotifications.executionSuccess(...)` based on the agent API's mock result — no real signature, no chain interaction.
- A few API routes (`execute-rebalance`, `dca-execute`, `transaction-bundle`, `mev-scan`) have `MOCK_MODE` branches that return `mock_signature_…` strings; safe in dev but the UI doesn't differentiate the two.
- `useTransactionExecutor.ts` and `working-swap/page.tsx` already do the **right** pattern (sendRaw → confirmTransaction → throw on err). We should standardize on this.

## Plan

### Phase 1 — Make Atlas swaps actually confirm (fix false positives)
In `src/components/atlas/atlas-client.tsx`, refactor `executeSwap`, `executeStake`, `executeLp`:
1. Fetch `getLatestBlockhash` before signing so we have `{ blockhash, lastValidBlockHeight }`.
2. `sendRawTransaction` with `skipPreflight: false`, `maxRetries: 3`, `preflightCommitment: "confirmed"`.
3. Show a **pending** toast immediately (with the signature + Solscan link, marked "Pending…").
4. `await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")`.
5. On `confirmation.value.err` → `toast.error("Swap failed on-chain", …)` with the parsed error.
6. On success → upgrade the toast to confirmed (persist this one to the bell).
7. Also verify post-confirmation balance changed via `getParsedTransaction` (optional but kills any remaining ambiguity).

### Phase 2 — Centralize the confirmation pattern
Create `src/lib/solana/send-and-confirm.ts` exposing `sendAndConfirmSigned(connection, signedTx, { onPending, onConfirmed, onError })`. Replace ad-hoc `sendRawTransaction` calls in `atlas-client.tsx`, `AgentExecutor.tsx`, agent paths, and `useTransactionExecutor.ts` with this helper so every send path has the same pending → confirmed → error lifecycle and toast pattern.

### Phase 3 — Honest agent execution toasts
- `AgentExecutor.tsx` / `AgentDashboard.tsx`: stop calling `executionSuccess` unless the result contains a real `signature` that has been confirmed. If the agent only produced a plan / approval request, fire `approvalRequested` or `executionPending` instead.
- Add a clear `executionPending(strategy, signature)` helper in `toast-notifications.ts` that shows a spinner + Solscan link, and gets upgraded to `executionSuccess` once `confirmTransaction` resolves (or `executionFailed` on error).
- Mark **only confirmed** transactions as `persist: true` so the bell history reflects real on-chain events, never optimistic ones.

### Phase 4 — Make the swap widget feel like more than 2 tokens
In `src/components/atlas/JupiterSwapCard.tsx`:
- Add a small token-pair toolbar above the Jupiter widget with curated chips: `SOL`, `USDC`, `USDT`, `JUP`, `BONK`, `JTO`, `WIF`, `PYTH`, `mSOL`, `JitoSOL` (mints already used elsewhere in the app).
- Clicking a chip re-initializes the Jupiter plugin with that mint as input (or output, via a small In/Out toggle).
- Persist last-used pair in `localStorage` (`atlas:swap:lastPair`) and rehydrate on mount.
- Accept `?in=<mint>&out=<mint>` URL params so deep-links from `TokenIntelCard` / portfolio rows can open the widget pre-filled.

### Phase 5 — Mock-mode visual indicator (small but important)
When `process.env.NEXT_PUBLIC_MOCK_MODE === "true"` (dev only), badge any toast/notification produced from a mock route with a small `SIMULATED` chip so we never confuse mock signatures with real ones during testing.

## Files to touch
- `src/components/atlas/atlas-client.tsx` — proper confirm flow for swap/stake/LP
- `src/components/atlas/JupiterSwapCard.tsx` — token chips, persistence, URL params
- `src/lib/solana/send-and-confirm.ts` — **new** shared helper
- `src/lib/toast-notifications.ts` — `executionPending` helper, upgrade-on-confirm, mock badge
- `src/components/AgentExecutor.tsx`, `src/components/AgentDashboard.tsx` — only celebrate real signatures
- `src/lib/hooks/useTransactionExecutor.ts` — route through shared helper for consistent UX

## Risks / notes
- `confirmTransaction` can take 10-30s on mainnet; the pending toast must be non-dismissable until resolved (or auto-replaced).
- `skipPreflight: false` will surface real simulation errors *before* signing — better UX, but some legitimate Jupiter routes with ALTs occasionally fail simulation. Fallback: if preflight fails, retry once with `skipPreflight: true` then **still require `confirmTransaction`**.
- We should not change wallet adapters or RPC endpoints in this pass.

