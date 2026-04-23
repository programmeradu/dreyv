# dreyv waitlist

> Invite-only access to dreyv — the non-custodial Command-Ops workspace for treasuries.

## What this is

A two-track front door:

- **Waitlist (gated)** — qualified pipeline for treasuries, DAOs, funds and protocols. Cohort-based onboarding with a real walkthrough.
- **Self-serve Free** — solo devs, curious users, and agents can sign up directly at `/auth` for read-only Atlas + sandbox Studio.

## Apply

- Page: /waitlist
- API: POST /api/waitlist
  - Body: `{ email, name?, organization?, role?, orgType?, chains?, currentStack?, aumBand?, useCase?, referralSource? }`
  - Response: `{ ok, position }` or `{ ok, alreadyOnList: true, position, status }`

## Cohort cadence

- Current cohort: 03 (rolling — invites sent weekly)
- Selection criteria: fit by chain, stack, and treasury shape — not signup order
- Invite link: single-use, 14-day expiry

## What the recipient should expect

1. Confirmation email with their position number
2. Cohort review (no countdowns, no fake urgency)
3. Single-use invite when their slot opens

## Related

- Pricing: /pricing — machine-readable: /pricing.md
- Compare: /compare
- Developer surface: /developers
- Self-serve auth: /auth
