---
name: treasury landscape research
description: Phase-1 research for /app/treasury rebuild. Competitor coverage matrix (Squads, Realms, Coinshift, Utopia, Multis, Den, Karpatkey, Sablier/Streamflow/Superfluid, Request, TRES/Fireblocks, Netrunner) + user-need ranking + agentic-finance differentiator + bucket priorities (build first / next / later) used by Phase 3 foundation build.
type: feature
---

# Treasury landscape — research synthesis (Apr 2026)

Source: web + competitor docs + DAO-ops playbooks + agentic-finance Q1 2026 reports. See chat for cited URLs (Squads v4, Squads spending limits, Coinshift docs, Utopia/Multis xyzeo reviews, Karpatkey Balancer 2025 review, Steakhouse Linea report, Sablier payroll posts, Cambrian Q1 2026, Treasury & Risk agentic AI, Netrunner, ChainwiseCPA multi-wallet cost basis).

## 1. Competitor coverage matrix (✓ shipped / ◐ partial / ✗ missing)

| Bucket | Squads (Sol) | Realms | Coinshift (EVM) | Utopia Labs | Multis | Den (Sol) | Sablier/Streamflow/Superfluid | Request Finance | Karpatkey/Steakhouse |
|---|---|---|---|---|---|---|---|---|---|
| 1. Tokens / valuation | ✓ basic balances | ✓ DAO-scoped | ✓ multi-safe rollup | ✓ + fiat | ✓ multi-chain | ◐ | ✗ | ✗ | ✓ (reports) |
| 2. Mass send-outs (payroll/airdrop/grants) | ◐ batch tx | ✗ | ✓ payroll | ✓ payouts | ✓ payroll | ◐ | ✓ streams | ✓ invoices→batch | ✗ |
| 3. Payments ops (recurring, gas tank, invoices) | ◐ Spending Limits | ✗ | ✓ accounting | ✓ fiat off-ramp | ✓ subs | ✗ | ✓ continuous | ✓ invoices | ✗ |
| 4. Governance & reporting | ✗ | ✓ proposals/votes | ✓ exports | ◐ | ◐ | ✗ | ✗ | ◐ | ✓ monthly PDFs |
| 5. Accounting & controls (policy, allowlists, audit) | ✓ multisig + spending limits + timelock | ◐ on-chain only | ✓ ERP-grade | ◐ | ✓ approvals | ◐ | ✗ | ✓ | ✓ (manual) |
| 6. DeFi mgmt (yield/hedge/rebalance/liq) | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ | ✗ | ✗ | ✓ (managed) |
| 7. Wallet / asset security | ✓ best-in-class on Sol | ◐ | ◐ uses Safe | ◐ Safe | ◐ Safe | ✓ | ✗ | ✗ | manual |

Honest read: **nobody ships all 7 buckets**. Squads owns security on Solana but has no yield/hedging/governance reporting. Coinshift owns accounting/payments on EVM but has nothing on Solana and no DeFi management. Karpatkey delivers DeFi + reporting but as a service, not a product. Sablier/Streamflow are single-purpose. **There is no integrated Solana-native treasury product.** That's the gap.

## 2. What users actually complain about / want (signal from forums, docs, Sablier blog, ChainwiseCPA, Treasury & Risk)

Ranked by frequency:
1. "Multisig approvals are a tax on every transaction" → spending limits / policy-derived auto-approval (we already have).
2. Manual payroll via spreadsheet + monthly batch tx → wants real-time streams, CSV import, recipient address book, status visibility for the recipient.
3. No clean cost-basis / tax export across multiple wallets and protocols (DeFi positions especially) → multi-wallet roll-up + per-protocol P&L.
4. Treasury reports are PDFs hand-built monthly → wants live, shareable, public-link reports (Karpatkey-style but self-serve).
5. Yield is left on the table: stables sit idle in safes; teams don't know which DeFi venue is safe + within risk tolerance → curated, policy-bounded yield routing with risk attestations.
6. Runway visibility ("how many months left at current burn?") is absent in every tool.
7. Governance is bolted on (Realms) or absent — operators want proposal → execution traceability without leaving the treasury.
8. Gas-tank top-ups, contributor onboarding (signers, allowlists), and invoice reconciliation are universally manual.
9. Emerging in 2026: agentic delegation — operators want to *describe intent* ("keep 12 months runway, route stables to ≤medium-risk yield, alert me before any move >5%") and have the system enforce it. Treasury & Risk + Cambrian Q1 2026 confirm this is the frontier.

## 3. Dreyv differentiator (what only we can do)

We already ship the substrate competitors don't have:
- DACS pipeline = intent → plan → HITL → executor → episodes → post-mortem (none of them have this).
- 48-capability registry across treasury/payments/policy/risk/yield (covers 5 of the 7 buckets natively).
- Specialists with CATP v1.0 envelope (payments, treasury, yield, risk, policy already exist).
- Sub-agent runtime for autonomous watchers (runway, gas-tank, grants, liquidations).
- Canvas = generative-UI substrate (none of the competitors stream UI from agents).

**Positioning** = "the agentic Solana treasury" — a single product where every bucket is delivered through natural-language intent and autonomous watchers, with multisig security underneath. Squads-grade safety + Coinshift-grade ops + Karpatkey-grade DeFi + Sablier-grade payroll, behind one CommandBar.

## 4. Bucket priorities for Phase-3 foundation build

Build-first (foundation must accommodate from day one — already have capabilities, just need surface):
- **Tokens / valuation** (live, no mocks; multi-wallet rollup; provenance per token).
- **Runway** (months-of-runway curve from on-chain burn — universally missing, easy win).
- **Mass send-outs** (mass_dispatch capability exists; needs CSV import + address book + recipient status).
- **Policy / approvals** (HITL queue exists; surface as "pending decisions" rail with human-language rationale).

Build-next (once foundation is in, wire these specialists):
- **Yield** (curated, policy-bounded routing — yield specialist + risk specialist already exist).
- **Recurring payments / gas tank** (gas-tank watcher + payments capability exist).
- **Reporting** (burn statement cron + research-brief capabilities exist; surface as shareable public link).

Build-later (depend on adoption signal):
- **Hedging / drift** (drift-hedge capability exists; only relevant for AUM > N).
- **Governance** (proposal traceability — only if users ask; don't compete with Realms head-on).
- **Tax/cost-basis export** (tax-lot engine exists; surface once accounting users land).

## 5. Foundation page contract (informs Phase 3)

- `/app/treasury` becomes a **Canvas surface** scoped to treasury intent. No fixed sections.
- 4 always-on rails: Hero (valuation), Pulse (autonomous watcher narratives), Action (treasury-scoped CommandBar dock), Stream (canvas blocks emitted by agents/CommandBar).
- Every bucket renders only when there's a real block/watcher/suggestion. Empty buckets → single "Ask Dreyv to set this up" affordance opening CommandBar pre-filled.
- Empty/unconnected state: connect-wallet or paste-address CTA + 3 example prompts that route through CommandBar. **Never** mock figures.
- All renderers respect Stitch-light brand (white, violet `#7c3aed`, Manrope, ambient glows, violet-200 borders, no gradients/fuchsia, no technical chrome).
