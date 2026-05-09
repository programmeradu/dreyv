# Crypto subscriptions (alongside Paystack)

## Goals
- Add a second checkout rail next to Paystack across two ecosystems:
  - **Solana**: USDC, USDT, SOL
  - **EVM**: USDC + USDT on Base, Arbitrum, Polygon, BNB Chain
- Two renewal modes per subscription: **manual** (pay each cycle from CommandBar) and **auto-debit** (sign once, Dreyv pulls each cycle).
- 10% discount vs USD card price → Mini $44.10 / Max $179.10 per month, settled in the chosen stable (USDC or USDT, 1:1) or SOL (live-priced).
- Payments land in **Dreyv-controlled receiving wallets** you provide (one Solana, one EVM — same EVM address works across Base/Arbitrum/Polygon/BNB).
- Same `users.tier` field flips on success — no parallel entitlement system.

## What changes for the user
- `/pricing` and `/app/billing` show a **Pay with crypto** toggle. Picking it reveals chain → asset → renewal-mode choice.
- After paying, tier upgrades within ~1 block confirmation; renewal status visible in `/app/billing`.
- CommandBar gets a `pay_subscription` capability so users can renew with one sentence ("renew Mini with USDT on Polygon").

## Architecture

```text
                                  ┌────────────────────────┐
  /pricing  →  /app/billing  ───▶ │  POST /api/billing/    │
  (UI toggle: card | crypto)      │  crypto/checkout       │ creates crypto_invoice row,
                                  └─────────┬──────────────┘ returns memo + receiving addr + amount
                                            │
                  ┌─────────────────────────┴──────────────────────────┐
                  ▼                                                    ▼
       Manual renewal (one tx)                         Auto-debit (signed once)
       user signs SPL/ERC20 transfer                   user signs:
       to receiving wallet                              • Solana: SPL token Approve to
                                                         dreyv-debit PDA (delegate)
                                                       • EVM: Permit2 signature granting
                                                         allowance to dreyv-debit contract
                                            │
                                            ▼
                              ┌──────────────────────────┐
                              │  Indexer (Supabase edge  │  Helius webhook for Solana,
                              │  fn `crypto-billing-     │  Alchemy address activity for
                              │  watcher`, polled every  │  Base/Arbitrum/Polygon, BNB via
                              │  60s by Inngest)         │  QuickNode/Ankr (Alchemy doesn't
                              └────────────┬─────────────┘  cover BNB) → matches memo /
                                           │                amount / asset / contract
                                           ▼
                              marks invoice paid, advances
                              users.tier + users.tier_renews_at
                                           │
                                           ▼
                              Inngest cron `subscription-renew`
                              runs daily → for any subscription
                              with auto_debit=true and renews_at
                              ≤ now+24h, builds + submits a debit
                              tx using stored allowance
```

## Supported assets per chain
| Chain | Native | Stables | Token contract source |
|---|---|---|---|
| Solana | SOL | USDC, USDT | mainnet SPL mints (USDC `EPjF…`, USDT `Es9v…`) |
| Base | — | USDC, USDT | USDC native `0x833589…`, USDT `0xfde4…` |
| Arbitrum | — | USDC, USDT | USDC native `0xaf88…`, USDT `0xFd086…` |
| Polygon | — | USDC, USDT | USDC native `0x3c499…`, USDT `0xc2132…` |
| BNB Chain | — | USDC, USDT | USDC `0x8AC76a…`, USDT `0x55d398…` (18-dec) |

Note: BNB USDT uses **18 decimals** (not 6 like every other chain) — handled in the amount-encoding helper, not hardcoded per route. SOL is included for Solana but not natively for EVM (no native ETH/MATIC/BNB pricing rail in v1; stables only on EVM).

## Data model (new tables)
- `crypto_subscriptions` — one per user × tier × chain. Fields: `tier`, `chain` (`solana|base|arbitrum|polygon|bsc`), `asset` (`usdc|usdt|sol`), `auto_debit`, `delegate_authority` / `permit2_signature`, `next_renewal_at`, `status`, `payer_address`.
- `crypto_invoices` — one per billing cycle. Fields: `subscription_id`, `amount_minor` (bigint, decimals-aware), `asset`, `chain`, `memo` (random 8-byte tag), `receiving_address`, `status` (`pending|confirmed|expired|failed`), `tx_signature`, `expires_at`.
- `receiving_wallets` (config table): `chain`, `address`, `active`. Seeded with the wallets you provide (1 Solana row + 1 EVM row reused across Base/Arbitrum/Polygon/BNB).
- `crypto_token_registry` (config table): `chain`, `asset`, `contract_address`, `decimals`, `enabled`. Single source of truth for token addresses + decimals; lets us add chains/stables without code changes.

RLS: users see only their own rows; service role inserts confirmations.

## Edge functions (Supabase)
1. `crypto-checkout` — creates an invoice, returns `{ amount, asset, chain, contract, decimals, receivingAddress, memo, expiresAt, qrPayload }`. Computes amount from USD price → 1:1 for USDC/USDT or live SOL price (Jupiter).
2. `crypto-billing-watcher` — verifies a tx by signature: checks recipient + asset contract + amount + memo on-chain. Idempotent on `tx_signature`. Per-chain RPC adapter (Helius for Solana, Alchemy for Base/Arbitrum/Polygon, QuickNode/Ankr for BNB).
3. `crypto-auto-debit-run` — invoked by Inngest daily; for each due auto-debit subscription, builds + signs the debit tx with the dreyv-debit keypair and broadcasts.
4. `crypto-webhook-helius` / `crypto-webhook-alchemy` / `crypto-webhook-bnb` — push-notification path so confirmations don't wait for the 60s poll.

All webhooks use `verify_jwt = false` and validate a per-provider HMAC; `crypto-checkout` validates the SIWS session.

## Auto-debit details
- **Solana**: standard SPL `Approve` makes a Dreyv-controlled PDA the delegate of the user's USDC/USDT ATA up to a capped amount (e.g. 12 × monthly price). On renewal, dreyv-debit signs a `TransferChecked` from user → receiving wallet. Revocable any time from `/app/billing`.
- **EVM (Base / Arbitrum / Polygon / BNB)**: Permit2 — user signs a typed-data message granting a small dreyv-debit relayer the right to pull `amount` of USDC/USDT up to `expiry`. Permit2 is deployed at the same canonical address on all four chains. Relayer just calls `permit2.transferFrom(user, receivingWallet, amount, token)`. No new contract risk surface.

Both flows reuse the existing wallet adapters (`@solana/wallet-adapter`, `wagmi`).

## CommandBar capability
`pay_subscription` (new): inputs `{ tier, chain?, asset?, mode: "now"|"setup_auto" }`. Calls `crypto-checkout`, returns a structured payment card the CommandBar already renders for `tx_proposals`. Auto-debit setup returns the typed-data / approve tx for the user's wallet to sign.

## Failure / edge cases
- Underpayment → invoice stays `pending`, "top up X" suggestion.
- Overpayment → marked confirmed, excess credited to a `crypto_credit_balance` row per user×asset.
- Auto-debit failure (insufficient balance, revoked allowance, BNB gas spike) → subscription drops to `past_due`, email + inbox notification, manual fallback link.
- Asset price drift (SOL only): lock USDC-equivalent amount at invoice creation; SOL invoices expire in 15 min instead of 24h. USDC/USDT invoices expire in 24h.
- Wrong-chain sends (e.g. user pays USDC on Polygon but subscribed on Base): watcher detects via `crypto_token_registry`, auto-attaches to the matching subscription, logs a soft notice.

## Secrets needed
- `DREYV_DEBIT_SOLANA_KEYPAIR` (base58) — signs SPL delegate transfers.
- `DREYV_DEBIT_EVM_PRIVATE_KEY` — signs Permit2 `transferFrom` calls (used across Base/Arbitrum/Polygon/BNB).
- `ALCHEMY_API_KEY` — already needed for `/api/evm/holdings`; reuse for Base/Arbitrum/Polygon.
- `BNB_RPC_URL` (QuickNode or Ankr) + `BNB_WEBHOOK_AUTH` — new, BNB-specific.
- `HELIUS_API_KEY` / `HELIUS_WEBHOOK_AUTH` — already set; reuse.

(I'll prompt for the two debit keys + BNB RPC + ask you to paste the two receiving wallet addresses when we start building.)

## Phased rollout
1. **Phase 1 — Manual Solana (USDC, USDT, SOL).** Tables + token registry + `crypto-checkout` + Helius webhook + `/app/billing` UI toggle + tier flip. Smallest surface to validate end-to-end.
2. **Phase 2 — Manual EVM stables (USDC + USDT on Base, Arbitrum, Polygon).** Adds Alchemy webhook + multi-chain amount/decimals handling.
3. **Phase 3 — BNB Chain (USDC + USDT, 18-dec USDT).** Adds QuickNode/Ankr RPC + BNB webhook adapter.
4. **Phase 4 — Auto-debit (Solana SPL delegate, then EVM Permit2 across all four chains).** Adds debit keypairs, daily Inngest job, revoke UI.
5. **Phase 5 — CommandBar `pay_subscription` capability + 10% crypto discount strip on `/pricing`.**

## Out of scope (explicitly)
- BTC / Lightning, third-party rails (Sphere, Helio, Loop) — rejected.
- Annual-only crypto plans — keeping monthly parity with Paystack.
- Native ETH / MATIC / BNB as pay assets (stables only on EVM in v1).
- Refunds in crypto — handled manually for now.

## Open question before Phase 1
You'll need to provide the two receiving wallet addresses (one Solana, one EVM — same address reused across Base/Arbitrum/Polygon/BNB). Drop them in chat when you're ready and I'll start Phase 1.
