## Goal

After an agent pays — for a snapshot, a report, or a subscription — the user gets a polished, branded deliverable: a permanent dashboard record, an email, and (for reports) a downloadable PDF. No more "where did it go?".

## Money flow (for context)

- **USDC/SOL SKUs** → agent's hosted wallet signs an SPL transfer → lands **directly on Solana mainnet** to your merchant treasury address (`mintCryptoInvoice` resolves it). No Stripe involved.
- **Card SKUs** → Stripe / Paystack (existing `/api/x402/checkout` flow).

## What ships in this pass

### 1. New table `agent_deliverables`
Stores every paid output as a first-class entity (one row per payment that produces a deliverable).

Columns: `id`, `payment_id` → `agent_payments`, `user_id`, `api_key_id`, `kind` (`snapshot` | `report` | `subscription`), `sku`, `target_wallet` (nullable for subscription), `status` (`generating` | `ready` | `failed`), `summary` (jsonb — headline numbers), `payload` (jsonb — full structured data), `html_url` (permalink), `pdf_url` (R2, reports only), `email_to`, `email_message_id`, `email_sent_at`, `error`, `created_at`, `ready_at`, `expires_at`.

Indexed by user, api_key, payment.

### 2. Wallet resolver — `src/lib/agent/wallet-resolver.ts`
- `resolvePrimaryTreasuryWallet(userId)` → reads existing vault tables; returns the primary wallet or `null`.
- `listTreasuryWallets(userId)` → all candidates for the 409-clarify response.
- Pure read, no side effects.

### 3. `/api/x402/pay` refactor
- Body adds optional `target_wallet`.
- For `snapshot` / `report` SKUs:
  - If `target_wallet` omitted → resolve primary; if account has 0 → require it (return `409 wallet_required`); if account has >1 and none is primary → also return `409 wallet_required` with the candidate list so the agent can ask the human.
  - After Solana settlement, call `createDeliverable()` which:
    1. Runs `buildLiveVaultSnapshot` / report builder inline.
    2. Inserts the `agent_deliverables` row.
    3. (Reports only) renders a PDF and uploads to R2, sets `pdf_url`.
    4. Sends the email.
- For `dreyv.tier.*` SKUs:
  - Existing `users.tier` upgrade stays.
  - `createDeliverable({ kind: 'subscription' })` writes a subscription record + sends the activation email with the new tier, renewal date, and link to billing.
- Response gains a top-level `deliverable: { id, view_url, pdf_url?, kind, summary }`. Receipt token is still returned and continues to redeem the existing pull endpoints (idempotent).

### 4. Email templates (Resend, premium light, Manrope, violet)
Two new templates in `src/lib/emails/templates.tsx` matching the existing `WelcomeEmail` aesthetic (white bg, violet accents, `Mascot` helper):
- **`AgentDeliverableEmail`** — hero with the appropriate mascot pose (`celebrate` for snapshot/report), the SKU name, target wallet (truncated middle, full on hover), 3 headline stats from `summary`, big violet CTA "View full report", footer with the agent-key label so the operator knows which agent triggered it.
- **`SubscriptionActivatedEmail`** — `celebrate` mascot, the tier name, renewal date, what's unlocked (3 bullets), CTA to `/app/settings/billing`.

Both senders wired into `src/lib/email-service.ts` and called from `createDeliverable()`. Failures are logged but never block the payment response (delivery is fire-and-forget after settlement).

### 5. Premium asset
Generate one new mascot variant if missing — `dreyv-deliver.png` (mascot handing over a violet crystal envelope, 3D, transparent bg). If `public/mascot/dreyv-celebrate.png` already covers it, reuse; otherwise generate once and use across the email + view page hero.

### 6. Dashboard — view page `/app/agent/deliverables/[id]`
Premium light shell, white bg, violet ambient glows, Manrope, flat surfaces. Layout:
- Breadcrumb back to deliverables list.
- Hero: SKU name, mascot, target wallet, paid_at, agent-key label, tx_signature → Solscan.
- Stats row from `summary` (3–4 cards).
- Full payload rendered as a real report (for snapshot: holdings table + composition donut; for report: PnL, attribution, concentration, runway — using existing `/app/analytics` building blocks).
- "Download PDF" button when `pdf_url` set.

### 7. Dashboard — list page `/app/agent/deliverables`
Premium light table:
- Filter by kind (snapshot/report/subscription) + agent key + date range.
- Columns: when, kind (chip), SKU, target wallet (truncated middle), agent key label, amount USDC, status chip, "Open" link.
- Empty state with mascot + 1-line explainer.
- Row-level "Re-send email" action (re-fires the existing email; rate-limited to 3/hour per deliverable).

### 8. Nav
Add "Deliverables" entry in the agent section of the sidebar/nav next to "Keys" and "Wallet".

## Technical details

- Schema changes via Drizzle migration `db-migrations/0031_agent_deliverables.sql` + matching `schema.ts` entry.
- PDF generation: use existing Puppeteer-less path if present; otherwise render server-side with `@react-pdf/renderer` (already pulled in for some flows) — if neither, skip PDF for v1 and emit the HTML permalink only; the email button just deep-links to the view page.
- Email send is wrapped in try/catch inside `createDeliverable` — if it throws (Resend down, no email on account), the deliverable still saves with `email_sent_at = null` and the dashboard surfaces a "Resend" affordance.
- `target_wallet` is validated with the existing `SOLANA_ADDR_RE`.
- All new public-schema work is on the Vercel Neon DB (Drizzle), **not** Lovable Cloud / Supabase — so no Supabase migration tool, no Lovable Emails setup. We continue using the existing Resend + `EMAIL_FROM=dreyv <noreply@stauniverse.tech>` pipeline.

## Out of scope (deliberate)

- Webhook callbacks to the agent's caller (could come later as an "Agent callbacks" feature).
- Streaming/long-running report generation — v1 runs inline within the 60s `maxDuration` of `/api/x402/pay`. If a report ever exceeds that, we move to a job queue later.
- Stripe invoice PDFs for the card rail — separate flow, covered when we touch card-rail UX.

## Confirm before I build
Anything you want cut, added, or reshaped? Otherwise I'll execute exactly this.
