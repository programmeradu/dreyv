---
name: Waitlist System
description: /waitlist invite-only signup, AUM bands, status state machine, cohort cadence, two-track front door (waitlist + self-serve auth).
type: feature
---

# Waitlist

## Two-track front door

- `/waitlist` — gated, qualified pipeline for treasuries, DAOs, funds, protocols (primary marketing CTA).
- `/auth` — self-serve Free tier (solo devs, curious users, agents). Stays discoverable.

## Status state machine

`pending` → `invited` → `onboarded` (or `rejected`).

- `pending`: just submitted, awaits cohort review.
- `invited`: admin sent a single-use invite link (14-day expiry). `inviteToken` set.
- `onboarded`: signup completed via the invite link. Token cleared, `onboardedAt` set.
- `rejected`: explicit decline, no email sent.

## Cohort cadence

- Label: `Cohort 03`
- Window: rolling — invites sent weekly
- Invite expiry: `INVITE_EXPIRY_DAYS = 14`

## AUM bands (coarse buckets only — never prefilled)

`not_disclosed`, `sub_100k`, `100k_1m`, `1m_10m`, `10m_100m`, `100m_plus`

Per brand rule: never display demo figures. Never default the select.

## API surface

- `POST /api/waitlist` — public, rate-limited via `checkRouteLimit(req, "alerts")`. Dedupes by email.
- `POST /api/waitlist/invite` — admin only (role check via `users.role === 'admin'`). Sends invite email + sets token/expiry.
- `GET  /api/waitlist/verify?token=…` — used by `/auth?invite=…` to validate token state.
- `POST /api/waitlist/verify` — used after successful signup to mark `onboarded`.
- `GET  /api/admin/waitlist` — admin only. Filterable list + KPIs (total/pending/invited/onboarded/conversion/last7d).

## Emails

`WaitlistConfirmationEmail` and `WaitlistInviteEmail` in `src/lib/emails/templates.tsx`. Sent via existing Resend `email-service.ts` wrappers (`sendWaitlistConfirmationEmail`, `sendWaitlistInviteEmail`). Both use `DreyvLayout`.

## Marketing surfacing

- `SiteHeader` desktop + mobile primary CTA → `/waitlist` (`Get started` flow).
- `HeroSection` and `CTASection` ghost link → `/waitlist`.
- `sitemap.ts` includes `/waitlist`.
- `public/llms.txt` and `public/llms-full.txt` advertise `/waitlist` + `/waitlist.md`.
- Middleware adds `Link: </waitlist>; rel="related"` on public pages for agent discovery.

## Storage

`waitlist_entries` table in `src/db/schema.ts` (Drizzle). Migration: `scripts/sql/0005_waitlist_entries.sql`.
