# Pitch Case Studies — "What Dreyv would have caught"

## Goal

Turn 4 real, public Solana treasuries into pitch-ready case studies that quantify *what Dreyv would have caught* — idle yield, fee leak, concentration risk, approval hygiene, missed windows. Counterfactual analysis on public on-chain data, fully transparent framing.

## Target wallets (all 4)

1. **Marinade DAO Realm** — `899YG3yk4F66ZgbNWLHriZHTXSKk9e1kvsKEquW7L6Mo`
2. **Jito Foundation treasury** — resolve canonical address
3. **Drift Protocol DAO** — resolve canonical address
4. **Named whale** — propose 2–3 verifiable public addresses (Toly, Ansem, Mert), let you pick one

I'll verify each address against Helius before generating.

## What each case study computes

Single one-pager per wallet with these sections, all from real on-chain data:

| Section | Source | Output |
|---|---|---|
| **Snapshot** | Helius DAS | Total USD, holdings, age, multisig status |
| **Idle capital leak** | Holdings × `/api/yield/rates` | "$X USDC/SOL idle N days → $Y/yr forgone at prevailing APY" |
| **Fee & slippage leak** | Helius enhanced tx + Jupiter quote replay | "Z swaps executed N bps above optimal route → $A overspent" |
| **Concentration risk** | Composition % | "X% in one asset, no rebalance trigger" |
| **Counterparty exposure** | Tx counterparties + label db | "N% outflows to CEX hot wallets, no approval gate" |
| **Approval hygiene** | Multisig audit | "Single-sig on $XM" or "M/N multisig — N inactive signers" |
| **Missed yield windows** | Historical APY × holdings timeline | "When mSOL APY hit X% on date Y, wallet held native SOL — $Z forgone" |
| **What Dreyv would have done** | Rule engine | 4–6 concrete proposals tied to the findings above |

Every number is sourced and verifiable. No fabrication. If a data point isn't available, the section says so plainly.

## Surfaces

### Public — `/case/[address]`
Pitch-ready one-pager. Stitch-light aesthetic matching `/pricing`. Header: "Counterfactual analysis on public on-chain data. Treasury not affiliated with Dreyv." OG image auto-generated so it screenshots cleanly into the deck.

Routes:
- `/case` — index listing the 4 featured case studies
- `/case/[address]` — the one-pager

### Internal — `/app/studio/case-studies`
Generator behind the team allowlist. Paste any address → runs the same pipeline → preview → "Publish to /case/[address]". Lets you regenerate for new wallets on demand.

## Technical

- New route group `src/app/case/`, internal page at `src/app/app/studio/case-studies/`
- New lib `src/lib/case-study/builder.ts` — orchestrates the 8 computations, returns a typed `CaseStudy` object
- Reuses existing infra: `buildFeaturePack`, `buildLiveVaultSnapshot`, `getEnhancedTransactions`, `/api/yield/rates`, `/api/treasury/security`, label db, Jupiter price/quote
- One new internal API route `/api/case-study/[address]` returns the computed object (cached in Postgres for 24h via a tiny `case_studies` table — generate-once, screenshot-many)
- Narrative bullets ("What Dreyv would have done") generated via Lovable AI edge function using the structured findings as input — calm founder voice, no fluff
- OG image: edge `opengraph-image.tsx` per case showing wallet label + headline savings number

## Out of scope

- No new charts library — reuse what `/app/analytics` already has
- No live monitoring claims — the page is explicit it's a snapshot
- No outreach automation — that's a separate workstream

## Deliverable

After approval:
1. Migration for `case_studies` cache table
2. Builder lib + API route
3. Public `/case` + `/case/[address]` pages
4. Internal generator at `/app/studio/case-studies`
5. 4 generated case studies (Marinade, Jito, Drift, your pick of whale)
