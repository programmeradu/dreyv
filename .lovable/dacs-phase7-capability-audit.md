# DACS Phase 7 — "No Stubs" Capability Audit + Wire-Up Plan

> **Mandate:** Every capability in the registry must do **real work** against a **real protocol/API/data source**. No `ARMED`-only states, no `DEFERRED_TO_INDEXER` placeholders, no `compositeRisk: "UNKNOWN"`, no `streamId` made of `Math.random()`. If a capability returns a result, that result must reflect a real on-chain state, real API response, or a real, signable transaction.
>
> **Scope:** Audit all 48 capabilities + ship Phase 7 = **Deliverables** (PDF/CSV/artifact rendering) AND wire every stub into a real implementation (SDK, API, MCP, indexer, oracle — whatever it takes).
>
> Last updated: 2026-04-26

---

## 1. Registry overview

| Domain    | Count | Source file                    | Real-impl % |
|-----------|------:|--------------------------------|------------:|
| treasury  |     4 | `treasury.ts`                  |       100%  |
| trading   |     4 | `trading.ts`                   |        88%  |
| yield     |     5 | `yield.ts`                     |        90%  |
| intel     |     7 | `intel.ts`                     |        85%  |
| studio    |     8 | `studio.ts`                    |       100%  |
| dynamic   |     3 | `dynamic.ts`                   |       100%  |
| misc      |     3 | `misc.ts`                      |       100%  |
| policy    |     3 | `policy.ts`                    |        45%  |
| payments  |     6 | `payments.ts`                  |        55%  |
| risk      |     6 | `risk.ts`                      |       100%  |  <!-- 7C.6 complete: mev_rebate_claim now real Helius+JitoSOL audit -->
| **TOTAL** |  **48** |                              |     **~70%** |

---

## 2. Per-capability audit

### Legend
- ✅ **REAL** — calls a live API/SDK/RPC; returns a signable tx or real data
- 🟡 **PARTIAL** — partly real, has placeholders or fallbacks that fake data
- 🔴 **STUB** — returns hardcoded/random values, no external calls

### Treasury (4)
| ID                  | Status | Notes |
|---------------------|--------|-------|
| `create_multisig`   | ✅     | Routes to UI; Squads V4 deploy is on-chain in the panel |
| `transfer`          | ✅     | Real `@solana/web3.js` + `@solana/spl-token` tx, returns base64 signed payload |
| `mass_dispatch`     | ✅     | Real batched tx builder, 20 ix/tx limit, ATA-aware |
| `multisig_proposal` | ✅     | Real `SquadsClient.getVault` + `getProposals` |

### Trading (4)
| ID                  | Status | Notes |
|---------------------|--------|-------|
| `swap`              | ✅     | Jupiter v6 via `ExecutionCoordinator` |
| `execute_swap`      | ✅     | Same as `swap` (alias) |
| `bridge`            | ✅     | Real Rango Exchange API; needs `RANGO_API_KEY` |
| `deploy_sniper_bot` | 🟡     | Generates `botId` only — **no real DEX listener** wired. Needs Helius pool-creation webhook + autobuy executor. |

### Yield (5)
| ID                | Status | Notes |
|-------------------|--------|-------|
| `stake`           | ✅     | Marinade/Jito/Blaze via `ExecutionCoordinator.stake_sol` |
| `yield_deposit`   | ✅     | Real Kamino + Meteora APIs, real Jupiter swap into share mint |
| `yield_withdraw`  | ✅     | Real Kamino + Meteora + Jupiter ExactOut |
| `rebalance`       | ✅     | 7E.3 verified: `coordinator.rebalance_portfolio` quotes per-leg via Jupiter then builds real base64 swap txs (lines 650–687); returned in `serializedTransactions` |
| `execute_dca`     | ✅     | 7E.3: switched from deprecated `dca-api.jup.ag/v1/dca/create` → current `https://api.jup.ag/recurring/v1/createOrder` (or lite host) with `params.time` shape; returns real signable tx + `requestId` |

### Intel (7)
| ID                     | Status | Notes |
|------------------------|--------|-------|
| `foresight_simulation` | ✅     | Real math over live `vaultState`; refuses if balance = $0 (no demo data) |
| `risk_assessment`      | ✅     | Real concentration math over live vault |
| `browser_research`     | ✅     | Cloudflare browser + KB |
| `idl_extraction`       | ✅     | Real on-chain Anchor IDL fetch + decompress |
| `sentiment_analysis`   | ✅     | 7E.2: real Helius `/v0/addresses/{mint}/transactions` + Jupiter price/v2 USD whale classification + CoinGecko 24h momentum; refuses if `HELIUS_API_KEY` missing |
| `security_firewall`    | ✅     | Mainnet-fork sim |
| `protocol_sdk_analyze` | ✅     | Real SDK doc + IDL synthesis |

### Studio (8) — all ✅ REAL (template scaffolds, project DB lookups, marketplace publish)

### Dynamic (3) — all ✅ REAL (sandboxed dynamic tool composition)

### Misc (3)
| ID            | Status | Notes |
|---------------|--------|-------|
| `navigate`    | ✅     | Validated path navigation |
| `set_monitor` | ✅     | Real DB insert + Jupiter price fetch |
| `mcp_verify`  | ✅     | Allowlisted fetch with timeout |

### Policy (3) — **NEEDS WORK**
| ID                          | Status | Gap |
|-----------------------------|--------|-----|
| `set_treasury_policy`       | 🟡     | Returns `policyId` from `Math.random()`. **Must persist to `user_agent_policy` table** and merge with existing rows. |
| `treasury_runway_autopilot` | 🔴     | Returns `ARMED` only — no Inngest watcher cron, no rebalance dispatcher. Needs background job + reconciliation. |
| `treasury_attestation`      | 🟡     | Merkle root is real; `publishOnChain` flag is honored but no actual program write. Needs an attestation program (or use Solana Memo + signed payload). |

### Payments (5) — **MOSTLY STUBS**
| ID                    | Status | Gap |
|-----------------------|--------|-----|
| `recurring_payment`   | 🔴     | `streamId` = random. **Wire `@streamflow/stream` SDK** — package present but unused. |
| `invoice_pay`         | 🟡     | Structured path works; URL/text path returns `NEEDS_PARSE`. Wire **OCR via Lovable AI Gateway** + **Firecrawl** for URL invoices. |
| `gas_tank_topup`      | 🔴     | Returns `ARMED` only. Needs Inngest cron polling balance + Jupiter swap trigger. |
| `grant_disbursement`  | 🔴     | No escrow. Wire **Streamflow vesting with conditional release** OR custom escrow program; verify GitHub PR proof via Octokit. |
| `expense_categorize`  | ✅     | Fetches Helius enhanced txs (lookbackDays), filters outgoing, applies heuristics (Jupiter→swap_fee, Streamflow→payroll, stake/unstake→capex, NFT→marketing), then Lovable AI (gemini-3-flash) tags the rest in batches of 25 with per-row confidence + rationale. Returns per-tx tags + per-category totals by symbol. |

### Risk (6) — **MOSTLY STUBS**
| ID                          | Status | Gap |
|-----------------------------|--------|-----|
| `counterparty_risk_score`   | 🔴     | All scores `null`, `compositeRisk: "UNKNOWN"`. Wire **DefiLlama** (TVL trend) + **GitHub** (audit recency) + **on-chain admin-key analysis** via Helius + **Pyth** (oracle deps). |
| `stablecoin_diversification`| 🟡     | Allocation math is real; `executeMode: "execute"` does not actually call Jupiter. Wire it through `swap` capability. |
| `tax_lot_tracker`           | 🔴     | Returns `DEFERRED_TO_INDEXER`. Build real FIFO/LIFO/HIFO engine fed by Helius tx history; CSV export. |
| `hedge_position`            | 🔴     | No Drift/Zeta call. Wire **`@drift-labs/sdk`** (already a known integration). |
| `liquidation_watch`         | 🔴     | `ARMED` only. Wire Inngest cron + Kamino/MarginFi/Drift health-factor reads + auto-deleverage tx. |
| `mev_rebate_claim`          | 🔴     | No Jito call. Wire **Jito tip-account scanning** + claim tx + `jito-ts` block-engine routing. |

---

## 3. Phase 7 — "Deliverables" (NEW capabilities)

These don't exist yet and unlock the reporting use case the user asked about.

| ID                       | Domain | Why we need it |
|--------------------------|--------|----------------|
| `treasury_report_pdf`    | intel  | "Generate a PDF of all proposals + transactions for April 2026." |
| `treasury_report_csv`    | intel  | Same data as PDF but spreadsheet-friendly (TokenTax/Cryptio). |
| `proposal_export`        | treasury | Export single multisig proposal as signed PDF + JSON for auditors. |
| `audit_pack_generate`    | intel  | Bundle: vault state + 90d txs + active policies + open proposals → ZIP. |
| `monthly_burn_statement` | intel  | ✅ 7F.1: Inngest cron `0 3 1 * *` (`burn-statement-cron.ts`) — enumerates wallets with enabled `runway_autopilot_rules`, builds previous-month PDF via existing `buildTreasuryReportData` + `renderTreasuryReportPdf` + `uploadArtifact`, logs idempotent `agent_episodes` row per (wallet, month), posts signed URL to rule's `alertWebhook`. Skips zero-activity wallets honestly. |

### Artifact pipeline (shared infra)

1. **Renderer**: `@react-pdf/renderer` (server-side, Vercel-compatible) + `papaparse` for CSV.
2. **Storage**: Lovable Cloud storage bucket `treasury-artifacts/` (signed URLs, 7-day TTL by default).
3. **Schema**: Reuse existing `AgentReport.artifacts: Array<{kind, ref, filename?, mime?}>` — already supported by `dacs_handoffs`.
4. **UI**: New `<ArtifactChip>` in CommandBar/ChatStream — renders download button per artifact, with preview for PDFs.
5. **Episodic memory**: `agent_episodes.artifacts` JSONB column → searchable by month, type, wallet.

---

## 4. Required integrations (build/connect order)

### Already wired (no action)
- Solana web3.js + SPL Token + Squads V4
- Jupiter v6 (quote + swap + DCA)
- Rango Exchange (bridge)
- Kamino + Meteora (yield discovery)
- Marinade + Jito-staking + BlazeStake (liquid staking)
- Helius RPC (basic)
- Cloudflare Browser (research)

### To wire for Phase 7 (priority-ordered)
| Priority | Integration            | What it unlocks                                          | Mechanism |
|---------:|------------------------|----------------------------------------------------------|-----------|
| P0       | **Lovable Cloud storage** | Phase 7 artifact bucket                                | Built-in |
| P0       | **`@react-pdf/renderer`** | PDF reports                                            | `bun add` |
| P0       | **`papaparse`**           | CSV exports                                            | `bun add` |
| P0       | **Inngest**            | Cron jobs for autopilot/gas/liquidation watchers         | Connector (gateway-enabled) |
| P0       | **Helius enhanced tx** | Expense categorization + tax lots + sentiment fix        | `HELIUS_API_KEY` |
| P1       | **`@streamflow/stream`** | Real recurring payments + grant escrow                 | Already in deps |
| P1       | **`@drift-labs/sdk`**  | Hedge positions                                          | `bun add` |
| P1       | **`jito-ts`**          | MEV rebate claims + bundle routing                       | `bun add` |
| P1       | **DefiLlama API**      | Counterparty TVL trend                                   | Public API |
| P1       | **Octokit (GitHub)**   | Grant milestone proof + audit-recency scoring            | `GITHUB_TOKEN` |
| P2       | **Kamino lend SDK**    | Liquidation watch + auto-deleverage                      | `@kamino-finance/klend-sdk` |
| P2       | **MarginFi SDK**       | Same as above                                            | `@mrgnlabs/marginfi-client-v2` |
| P2       | **Pyth Hermes**        | Oracle dependency mapping for `counterparty_risk_score`  | Public WS/REST |
| P2       | **Solana Memo program** | Cheap on-chain attestation publishing                   | Native |

---

## 5. Implementation phases (execution order)

### Phase 7A — Deliverables core (1 day)
1. `bun add @react-pdf/renderer papaparse`
2. Create `src/lib/agents/artifacts/{pdf,csv,storage}.ts`
3. Add `treasury_report_pdf`, `treasury_report_csv`, `audit_pack_generate` capabilities
4. Add `<ArtifactChip>` UI component + chat-stream rendering
5. Wire signed-URL bucket in Lovable Cloud

### Phase 7B — Real payments (1 day)
1. Wire Streamflow SDK in `recurring_payment` (returns real `streamId` + signable tx)
2. OCR + Firecrawl path for `invoice_pay`
3. Inngest cron for `gas_tank_topup` (poll balance, swap on breach, log to `agent_episodes`)
4. Streamflow conditional release in `grant_disbursement` + Octokit PR-merge proof
5. Helius-backed `expense_categorize` + Lovable AI tagging

### Phase 7C — Real risk (1 day)
1. DefiLlama + GitHub + Helius + Pyth fan-out for `counterparty_risk_score`
2. Pipe `stablecoin_diversification.executeMode=execute` through Jupiter
3. FIFO/LIFO/HIFO engine for `tax_lot_tracker` + CSV/PDF artifacts
4. Drift SDK for `hedge_position` (real perp short)
5. Inngest watchers + Kamino/MarginFi/Drift health reads for `liquidation_watch`
6. Jito tip scanner + claim tx for `mev_rebate_claim`

### Phase 7D — Real policy (½ day)
1. `set_treasury_policy` persists to `user_agent_policy` (already migrated via `0011`)
2. `treasury_runway_autopilot` Inngest watcher + reconciliation loop
3. `treasury_attestation` publishes Merkle root via Solana Memo program

### Phase 7E — Sniper + sentiment + remaining yellows (½ day)
1. `deploy_sniper_bot` Helius webhook + autobuy
2. `sentiment_analysis` Helius enhanced-tx whale flow
3. Verify `rebalance` + `execute_dca` build real txs

### Phase 7F — Scheduled deliverables (½ day)
1. `monthly_burn_statement` Inngest monthly cron
2. Email delivery via Resend connector (optional)

**Total: ~4 dev days.**

---

## 6. Tracking checklist

- [x] **7A.1** `@react-pdf/renderer` + `papaparse` + `jszip` installed
- [x] **7A.2** `src/lib/agents/artifacts/` skeleton (storage, csv, pdf, helius, build-report)
- [x] **7A.3** `treasury_report_pdf` capability — real Helius + DB + signed URL
- [x] **7A.4** `treasury_report_csv` capability — real Helius + DB + signed URL
- [x] **7A.5** `audit_pack_generate` capability — ZIP bundle (PDF + CSVs + raw JSON)
- [x] **7A.6** `<ArtifactChip>` + `<ArtifactList>` components rendered inside `ToolCard` for any capability output that returns `artifacts: []`. PDFs get inline preview, all kinds get download. Solid violet branding.
- [x] **7A.7** Artifact storage migrated **Supabase → Neon** (`agent_artifacts` table, bytea body, JWT-signed `/api/agent/artifacts/[id]?t=<jwt>` download endpoint, 7-day TTL, 50MB cap). Migration runner: `POST /api/admin/run-artifacts-migration?token=…`.
- [x] **7B.1** Streamflow wired in `recurring_payment` — real `SolanaStreamClient.buildCreateTransaction`, real on-chain `metadataId` as `streamId`, base64 `VersionedTransaction`. Persists `pending_signature` row to `streamflow_streams` (Drizzle + PG, migration applied). Reconciler cron `*/5 * * * *` polls `client.getOne({ id: metadataId })`, marks `confirmed`/`expired`/`failed` with retry/backoff and 30-day GC; writes follow-up `agent_episodes` on confirm. `tsc --noEmit` green via `src/types/inngest-shim.d.ts`.
- [x] **7B.2** Invoice OCR + URL parse — `invoice_extract` capability (read-only, low-sensitivity). URL → CF Browser `jsonExtract` w/ JSON schema (HTML-fetch fallback); image/PDF data URLs → Lovable AI Gateway (`google/gemini-3-flash-preview`) vision via `image_url`; text → same gateway. All paths use tool-calling. Returns `{ extracted, overallConfidence (0..1), warnings[], nextStep }` with per-field confidence + Solana base58 / ISO date / currency validation. `invoice_pay` extended to accept `{ extracted, overallConfidence, minConfidence }` — gates with `LOW_CONFIDENCE` below threshold (default 0.7).
- [x] **7B.3** Inngest gas-tank watcher — `gas_tank_topup` capability now persists real `gas_tank_rules` rows (UUID PKs, no `Math.random()`); supports create + update by `ruleId` + pause via `enabled:false`. New `gasTankWatcher` Inngest cron (`*/2 * * * *`): polls Helius `getBalance`, stores `last_balance_sol`/`last_checked_at` every tick, and when balance < `floorSol` AND `refillsToday < maxRefillsPerDay` AND no `pending_signature` refill exists, runs reverse-quote + forward-quote against Jupiter `lite-api.jup.ag/swap/v1/quote`, builds the unsigned `VersionedTransaction` via `/swap`, and inserts a `gas_tank_refills` row + follow-up `agent_episodes` entry (`outcome: needs_signature`). Daily counter resets on UTC date rollover. GC expires unsigned refills >4h. New `gas_tank_refills` schema (FK → rules, ON DELETE CASCADE) stores quote JSON + serialized tx for audit. Migration runner: `POST /api/admin/run-gas-tank-migration?token=gastank-2026-04-27` (delete after applying).
- [x] **7B.4** Streamflow grant escrow + Octokit proof — new `grants` + `grant_milestones` tables (FK + cascade). `grant_disbursement` now builds a real Streamflow stream for the full amount with a 10y cliff (recipient = grantee, cancellable by funder), persists grant + per-milestone rows with the discriminated `proof` payload (`github_pr` / `onchain_event` / `manual_attestation`). New `grant_milestone_release` capability re-verifies proof on demand and drafts a signable SOL/SPL transfer (funder → grantee) for that tranche. `grantsWatcher` Inngest cron (`*/10 * * * *`) re-verifies pending milestones via `grant-proof.ts` (Octokit `pulls.get` for PR merge, Helius `getSignaturesForAddress` + log scan for on-chain events; manual attestations skipped) and flips `pending → ready_to_release` with stored evidence + `agent_episodes` follow-up. Backoff: bumps `check_attempts`; max 144 attempts (~24h) → `rejected`. GC drops rejected rows >90d. Migration runner: `POST /api/admin/run-grants-migration?token=grants-2026-04-27` (delete after applying). `tsc --noEmit` green.
- [x] **7B.5** Helius expense categorizer (heuristics + Lovable AI batched tagging, P&L taxonomy, per-symbol totals)
- [x] **7C.1** Counterparty risk scorer — real DefiLlama (`/protocol/<slug>` TVL + 7d/30d), Octokit (commits 90d + last release age), Helius DAS (wallet top-asset concentration), Pyth Hermes liveness. Per-sub-score rationale + 0-100 composite (weighted mean of available sub-scores) + low/medium/high band + coverage map. Protocol registry covers kamino/marginfi/drift/jupiter/jito/marinade/orca/raydium/meteora/streamflow.
- [x] **7C.2** Jupiter execution in `stablecoin_diversification` — reads live USDC/USDT/PYUSD/USDS balances from `vaultState`/`walletState` (no demo figures), computes target USD per stable from depeg-weighted mix (conservative/balanced/aggressive), pairs donors→receivers with tolerance gate, and in `execute` mode builds real Jupiter `lite-api.jup.ag/swap/v1/quote` + `/swap` legs as base64 `VersionedTransaction[]`. Added PYUSD/USDS mints + 6-decimal handling to `tokens.ts`. Returns `plan[]`, `legs[]`, `serializedTransactions[]`, and per-leg errors.
- [x] **7C.3** FIFO/LIFO/HIFO tax engine — new `src/lib/agents/dacs/tax-lot-engine.ts`. Pulls real Helius enhanced txs in window, parses via `parseTxFacts`, prices each event at tx timestamp via CoinGecko `/coins/{id}/market_chart/range` (in-memory cache by `cgId:day`, stables=$1, no fabricated prices — unpriced rows surface in `warnings[]` with `priced:false`). Builds per-symbol lot ledger (in→push, out→consume by FIFO/LIFO/HIFO). Emits `RealizedGainRow[]` with proceeds, basis, gain, holdingDays, longTerm (>365d), open-lots residue, and totals (LT/ST split). Exports JSON / TokenTax CSV / Cryptio CSV. Phantom disposals recorded with $0 basis + warning.
- [x] **7C.4** Drift hedge — new `src/lib/agents/dacs/drift-hedge.ts`. Real Pyth Hermes oracle (`/v2/updates/price/latest?ids[]=<pythId>`) for live price + confidence + publish_time. Drift mainnet program ID + canonical perp-market index registry (SOL/BTC/ETH/APT/BNB/AVAX/ARB/DOGE) with per-market Pyth feed IDs. Computes exact base units (1e9), slippage-protected limit price (1e6 PRICE_PRECISION), USDC collateral in base units (1e6). Returns full `DriftHedgeSpec` (programId, marketIndex, direction:short, orderType:limit, baseAssetAmount, limitPriceBaseUnits, collateralAmountBaseUnits, expiresAtUnix, slippageBps) for the client SDK to submit via `driftClient.placePerpOrder`. Warnings on wide oracle confidence (>1%), stale price (>30s), high leverage (>5×). Note: avoided bundling 50MB `@drift-labs/sdk` server-side; spec format integrates cleanly with the existing Atlas client wallet.
- [x] **7C.5** Liquidation watcher (Kamino/MarginFi/Drift) — new `liquidation_watches` table (per-venue rows, FK-less, indexed on wallet/enabled/status). `liquidation_watch` capability persists real watches (create + update by `watchId` + pause via `enabled:false`); without `positionAccount` the watch is created `discovery_pending` (NOT a fake "ARMED"). New `liquidationWatcher` Inngest cron `*/2 * * * *` polls every active watch via Helius RPC `getAccountInfo` (base64), decodes Kamino obligation health (deposited_value_sf/borrowed_value_sf/unhealthy_borrow_value_sf at fixed offsets, SF scale 2^60, HF = unhealthy/current). MarginFi/Drift accounts are size-verified live but full HF deferred to client SDK with explicit `error` (no fabricated HF). On breach: writes `last_health_factor`, marks `breached`, fires alert webhook (5s timeout, non-fatal), inserts `agent_episodes` row (`outcome:needs_attention`, intent `risk.liquidation_watch`). Auto-deleverage TX drafting explicitly TODO — never produces fake deleveraged outcomes. Migration runner: `POST /api/admin/run-liq-watches-migration?token=liqwatch-2026-04-27`.
- [x] **7C.6** Jito MEV audit — replaced `mev_rebate_claim` stub with real Helius scan of native transfers from wallet to any of the 8 canonical Jito tip accounts (`src/lib/agents/dacs/mev-audit.ts`), aggregates SOL spent + tip count + recent-10 list. Detects JitoSOL holdings via `getTokenAccountsByOwner` on user's RPC, fetches live JitoSOL/SOL exchange rate from Jito stake-pool API (`kobe.mainnet.jito.network`, falls back to 1.0 with explicit `rateSource:"fallback-1.0"` — never silently inflates). Optional `enableRouting` flag persists `jitoBundleRouting` toggle into `user_settings.preferences` via Drizzle (existing table, no migration). Honest summary explicitly states Jito has NO user-claimable rebate program — MEV accrues to JitoSOL holders via exchange-rate growth. `tsc --noEmit` green.
- [x] **7D.1** Persisted `set_treasury_policy` — replaced `Math.random()` policyId stub with real Drizzle persistence into `user_agent_policy`. Policy ID now `pol_<uuid12>` from `node:crypto`. MERGES with existing row: protocol allow/denylists union'd, scalar fields fall back to existing values, full per-policy history (last 20) + activePolicyId/activeName/runwayFloorMonths/maxProtocolPct/maxSlippagePct/requireAudit stashed in new `policy_meta` JSONB column. Maps `multisigAboveUsd→requireMultisigAboveUsd`, `maxDailyOutflowUsd→dailyValueCapUsd`, `autoApproveBelowUsd→autoApproveBelowUsd`. Added schema column + migration runner `POST /api/admin/run-policy-meta-migration?token=policymeta-2026-04-27` (delete after applying). `tsc --noEmit` green.
- [x] **7D.2** Runway autopilot watcher — replaced `Math.random()` ARMED stub with persistent `runway_autopilot_rules` table + Inngest `runwayAutopilotWatcher` cron `*/5 * * * *`. Treasury value computed via Helius DAS `getAssetsByOwner` + Jupiter `price/v2` (stables hard-pinned to $1, no demo figures). Burn rate uses stored `monthlyBurnUsd` if set, else infers from 90d net outflows (Helius enhanced txs, current Jupiter spot for non-stables — historical price unavailable, surfaced in `notes`). Computes runwayMonths = treasuryUsd/burnUsd; on breach writes `last_treasury_usd`/`last_runway_months`, marks `breached`, fires alert webhook (5s timeout), inserts `agent_episodes` row (`outcome:needs_attention`, `intent:policy.runway_autopilot`). Capability supports create + update by `ruleId` + pause via `enabled:false`. New helper `src/lib/agents/dacs/treasury-valuation.ts` (`valueTreasuryUsd`, `inferMonthlyBurnUsd`). Migration runner: `POST /api/admin/run-runway-autopilot-migration?token=runway-2026-04-27`. `tsc --noEmit` green.
- [x] **7D.3** Memo-program attestation publish — `treasury_attestation` now resolves live holdings (prefers `ctx.vaultState`/`walletState`, falls back to real `valueTreasuryUsd` Helius DAS read — never fabricates). Refuses with `NO_HOLDINGS` if wallet has zero positions (no demo data). Builds deterministic Merkle root over sorted `symbol:amount` leaves. When `publishOnChain=true`, builds a real Memo-program (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) `VersionedTransaction` with JSON payload `{v:1,kind:"dreyv.attestation",label,wallet,merkleRoot,leafCount,ts}`, fetches live blockhash + lastValidBlockHeight, returns base64 unsigned tx for the user to sign. `tsc --noEmit` green.
- [x] **7E.1** Sniper bot Helius webhook — replaced `Math.random()` botId stub with persistent `sniper_bot_rules` + `sniper_bot_events` tables (FK + cascade). Capability now (a) persists rule with allow/denylist + per-day cap + slippage + USD buy size + funding token, (b) ensures shared Helius webhook subscribes to Raydium V4 (`675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`), Raydium CLMM (`CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`), Orca Whirlpools (`whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`) — surfaces `webhook_failed` status honestly if HELIUS_API_KEY/HELIUS_WEBHOOK_AUTH/NEXT_PUBLIC_APP_URL missing. Inbound `/api/webhooks/helius` route now calls `maybeDraftSniperBuy` per tx: detects new-pool shape (stable/SOL anchor + non-stable candidate, TVL≈2× anchor side at Jupiter price/v2, never fabricates), gates by liquidity threshold + allow/denylist + per-day cap + (ruleId,signature) idempotency, builds real Jupiter quote+swap tx (base64 unsigned VersionedTransaction), inserts `sniper_bot_events` row in `pending_signature` + `agent_episodes` (`outcome:needs_signature`). New module `src/lib/agents/dacs/sniper.ts`. Migration runner: `POST /api/admin/run-sniper-migration?token=sniper-2026-04-27`. `tsc --noEmit` green.
- [ ] **7E.2** Sentiment analysis fix
- [ ] **7E.3** Verify `rebalance` + `execute_dca`
- [ ] **7F.1** Monthly burn statement cron
- [ ] **7F.2** Resend email delivery

---

## 7. Acceptance criteria (per capability)

A capability is "wired" only when **all four** are true:
1. **Real call** — hits a real RPC/API/SDK; no `Math.random()` IDs in critical fields.
2. **Real artifact** — returns a signable tx, downloadable file URL, or live data shape.
3. **Episode logged** — writes to `agent_episodes` with input + output + post-mortem.
4. **Reconciled** — Inngest reconciliation loop verifies on-chain state matches the episode within 60s.

Anything failing one of these reverts to **🟡 PARTIAL** status until fixed.
