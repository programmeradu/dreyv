

## Waitlist System — Plan

A public, premium-styled `/waitlist` page that captures qualified leads into the existing Postgres DB, sends a branded confirmation email, and gives you an admin cohort-management view to invite users in batches. Coexists with current `/auth` self-serve.

### 1. Public waitlist page — `/waitlist`

Match the locked premium light violet aesthetic (Manrope, white bg, ambient violet-400/300 glows, violet-200 borders, solid `#7c3aed` CTAs, custom crystal asset — no stock icons, no gradients).

Sections:
- Hero: "Command-Ops for treasuries. Invite-only." + cohort cadence line ("Cohort 03 onboarding [month]")
- Qualifying form (zod-validated, client + server):
  - Email (required)
  - Name
  - Organization name
  - Role (Treasurer / Operator / Founder / Developer / Other)
  - Org type (DAO / Fund / Protocol / Startup / Solo)
  - Chains used (multi: Solana / EVM / Both)
  - Current stack (free text, 280 char cap — Squads, Gnosis, spreadsheets, etc.)
  - AUM range (single-select bands, NEVER prefilled with demo figures per brand rule)
  - Use case (free text, 500 char cap)
  - Referral source
- Trust strip: "Non-custodial · Simulation-first · Multisig-native"
- Post-submit state: "You're on the list. Position #N. Watch your inbox." (no fake countdowns)

### 2. Database

New table `waitlist_entries` via Drizzle migration in `src/db/schema.ts`:

```text
id (uuid, pk)
email (text, unique, lowercased, indexed)
name, organization, role, org_type, chains[],
current_stack, aum_band, use_case, referral_source
status: 'pending' | 'invited' | 'onboarded' | 'rejected'
position (int, auto-incremented at insert)
invited_at, onboarded_at (nullable timestamps)
invite_token (text, nullable, unique)
created_at, updated_at, ip_hash, user_agent
```

RLS: insert allowed for anon (rate-limited); select/update only for admin role via existing `has_role` pattern.

### 3. API routes

- `POST /api/waitlist` — zod-validated insert, dedupe by email, rate-limited (reuse `checkRouteLimit` like `/api/alerts/subscribe`), returns `{ position }`.
- `POST /api/waitlist/invite` (admin only) — generates `invite_token`, sets status=`invited`, sends invite email, returns signup URL `/auth?invite=<token>`.
- `GET /api/waitlist/verify?token=...` — validates token at `/auth` so middleware lets the user complete signup; on success marks `onboarded` and clears token.
- `GET /api/admin/waitlist` (admin only) — paginated list with filters (status, org_type, chain, search by email/org).

### 4. Emails (Lovable transactional)

Two new templates in `src/lib/emails/templates.tsx`, sent via `send-transactional-email`:
- `WaitlistConfirmationEmail` — "You're #N on the dreyv waitlist", what to expect, link to `/compare` and `/developers`.
- `WaitlistInviteEmail` — "Your dreyv access is open" + signed invite link + 14-day expiry note.

Both use existing `DreyvLayout` so styling stays consistent.

### 5. Admin cohort view — `/app/admin/waitlist`

Premium light theme matching the redesigned monitoring center:
- KPIs: total signups, pending, invited, onboarded, conversion %, signups last 7d
- Filterable table with bulk-select + "Invite selected" action (calls `/api/waitlist/invite` per row, with a confirmation modal showing count)
- Per-row drawer with full submission + notes field
- CSV export

### 6. Auth flow integration

- `/auth` accepts `?invite=<token>`; on valid token, allows signup and on success calls `/api/waitlist/verify` to mark `onboarded` and link `users.id` to the waitlist row.
- `/auth` without invite still works for Free tier self-serve (does not break existing flow).
- Middleware: `/waitlist` and `/api/waitlist` are public; admin routes stay protected by `has_role('admin')`.

### 7. Marketing surface updates

- `SiteHeader`: add "Join waitlist" as the primary CTA on marketing pages (keep "Try Atlas" ghost). `/auth` "Get started" stays for direct self-serve.
- `HeroSection`: secondary CTA → `/waitlist`.
- `CTASection`: same.
- Add `/waitlist.md` (machine-readable) + entry in `llms.txt`, `llms-full.txt`, `sitemap.ts`, and a Link header in middleware (`rel="application/related"`) so agents can discover it.

### 8. Memory updates

- Add core rule: "Two-track front door — `/waitlist` (gated, qualified) + `/auth` Free tier (self-serve). Marketing primary CTA = waitlist; Free tier remains discoverable."
- Add feature memory `mem://features/waitlist` with cohort cadence, AUM bands used, status state machine.

### Out of scope (future)

- Referral leaderboard / position-jump mechanics
- Waitlist position widget with WebSocket live updates
- Stripe-style "skip the line" paid bump (not aligned with FastSpring tier model)

### Technical notes

- Reuse `getAuthUser`, `has_role`, `checkRouteLimit`, `DreyvLayout`, `marketingPrimaryCta`, `legal-prose` patterns already in repo.
- All copy must avoid hardcoded demo figures (no "$100k AUM" placeholders) per brand rule.
- Custom crystal asset for `/waitlist` hero generated via imagegen (no stock icons).
- Type-check (`npx tsc`) + Drizzle migration generated and applied before shipping.

