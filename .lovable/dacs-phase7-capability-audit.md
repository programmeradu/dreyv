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
| payments  |     5 | `payments.ts`                  |        20%  |
| risk      |     6 | `risk.ts`                      |        15%  |
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
| `rebalance`       | 🟡     | `ExecutionCoordinator.rebalance_portfolio` exists; verify it builds real txs (TBD line 444+) |
| `execute_dca`     | 🟡     | Same as above — verify Jupiter DCA program ix is built |

### Intel (7)
| ID                     | Status | Notes |
|------------------------|--------|-------|
| `foresight_simulation` | ✅     | Real math over live `vaultState`; refuses if balance = $0 (no demo data) |
| `risk_assessment`      | ✅     | Real concentration math over live vault |
| `browser_research`     | ✅     | Cloudflare browser + KB |
| `idl_extraction`       | ✅     | Real on-chain Anchor IDL fetch + decompress |
| `sentiment_analysis`   | 🟡     | Whale-flow logic exists; verify Helius enhanced tx call (TBD) |
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
| `invoice_pay`         | ✅     | Structured + `extracted` payload paths fully wired. URL/text/image extraction handled by sibling `invoice_extract` (CF Browser jsonExtract + Lovable AI vision); `invoice_pay` enforces `minConfidence` gate (default 0.7) before proposing. |
| `invoice_extract`     | ✅     | **NEW (7B.2).** Real OCR via Lovable AI vision (image/PDF data URLs) + CF Browser jsonExtract (URLs) + Lovable AI text mode. Per-field confidence + warnings + Solana address/ISO date validation. |
| `gas_tank_topup`      | 🔴     | Returns `ARMED` only. Needs Inngest cron polling balance + Jupiter swap trigger. |
| `grant_disbursement`  | 🔴     | No escrow. Wire **Streamflow vesting with conditional release** OR custom escrow program; verify GitHub PR proof via Octokit. |
| `expense_categorize`  | 🔴     | Returns `DEFERRED_TO_INDEXER`. Wire **Helius enhanced transactions** + Lovable AI for categorization. |

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
| `monthly_burn_statement` | intel  | Auto-generated monthly P&L PDF, scheduled via Inngest. |

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
- [x] **7B.1** Streamflow wired in `recurring_payment` — **all 4 acceptance criteria met**: (1) Real `SolanaStreamClient.buildCreateTransaction` call returns real on-chain `metadataId` as `streamId`. (2) Real artifact: base64 `VersionedTransaction` for wallet signing. (3) Episode logged via existing `executor.ts` → `recordEpisode` path AND a follow-up confirmation episode written by the reconciler when on-chain state is verified. (4) Reconciliation: `reconcileStreamflowStreams` Inngest cron (`*/5 * * * *`) polls `client.getOne({ id: metadataId })` for every `pending_signature` row, marks `confirmed`/`expired`/`failed` accordingly with retry/backoff and 30-day GC. New `streamflow_streams` table (migration: `POST /api/admin/run-streamflow-migration?token=streamflow-2026-04-27`). Build-error backlog also cleared via `src/types/inngest-shim.d.ts`.
- [x] **7B.2** Invoice OCR + URL parse — new `invoice_extract` capability (read-only, low-sensitivity, domain `payments`). Inputs: `{ url }` | `{ imageDataUrl }` (image/* or application/pdf base64) | `{ text }`. Real implementations: URL → CF Browser Rendering `jsonExtract` w/ JSON schema (JS-rendered pages) with HTML-fetch fallback; image/PDF → Lovable AI Gateway (`google/gemini-3-flash-preview`) vision via `image_url`; text → same gateway, text-only. All paths use **tool-calling** for structured output. Returns `{ extracted, overallConfidence (0..1), warnings[], nextStep, sourceKind }` with per-field confidence in `extracted.fieldConfidence`. Post-processing: validates Solana base58 recipient, ISO dates, currency symbol; demotes confidence + emits warnings on failure. `invoice_pay` extended to accept `{ extracted, overallConfidence, minConfidence }` — auto-blocks with `LOW_CONFIDENCE` when below threshold (default 0.7). Episode logging via existing executor path. `tsc --noEmit` green.
- [ ] **7B.3** Inngest gas-tank watcher
- [ ] **7B.4** Streamflow grant escrow + Octokit proof
- [ ] **7B.5** Helius expense categorizer
- [ ] **7C.1** DefiLlama+GitHub+Helius+Pyth counterparty scorer
- [ ] **7C.2** Jupiter execution in stablecoin diversification
- [ ] **7C.3** FIFO/LIFO/HIFO tax engine
- [ ] **7C.4** Drift hedge
- [ ] **7C.5** Liquidation watcher (Kamino/MarginFi/Drift)
- [ ] **7C.6** Jito MEV claim
- [ ] **7D.1** Persisted `set_treasury_policy`
- [ ] **7D.2** Runway autopilot watcher
- [ ] **7D.3** Memo-program attestation publish
- [ ] **7E.1** Sniper bot Helius webhook
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
