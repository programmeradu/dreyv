---
name: Scaffold public status pages
description: Pending UI work — public `/status/[slug]` route and owner-side `/app/status/*` admin for Phase 30 (Pillar AN, SLA).
type: feature
---

The Phase 30 backend (Pillar AN — SLA & Status pages) shipped 22 capabilities, RLS, and webhook events but no UI yet.

When the user asks to scaffold:
- Public route: `src/app/status/[slug]/page.tsx` — anon-readable, pulls from `public_api_status_pages` + `public_api_status_incidents` + `public_api_status_maintenance` (anon SELECT policies already in place). Show: page title/branding, component health grid, active incidents (with full update timeline), upcoming maintenance, last 90 days uptime sparkline, subscribe form (POST → `sla.subscribers_add`).
- Owner admin: `src/app/app/status/` — list/create pages, post incidents/updates, schedule maintenance, manage subscribers, view SLA credit ledger.
- Match Stitch-inspired premium LIGHT theme (white bg, Manrope, solid violet accents, violet-200 borders, ambient violet-400/300 glows) — never a dark first draft.
- Subscribe confirm route: `/status/[slug]/confirm?id=...&token=...` calls `sla.subscribers_confirm`.

Capabilities to wire:
`sla.pages_*`, `sla.incidents_*`, `sla.maintenance_*`, `sla.subscribers_*`, `sla.credits_*`, `sla.policy`.
