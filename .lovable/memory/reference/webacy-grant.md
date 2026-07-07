---
name: Webacy DD.xyz grant application
description: Submitted grant application for Webacy risk API integration; includes Webacy Pro promo code and application confirmation
type: reference
---

# Webacy DD.xyz Grant

Application submitted (2026). Received confirmation:

> Thank you for applying! We will get back to you shortly.
>
> We value projects that take security seriously. As a token of our appreciation, we would like to offer you 3 months of Webacy Pro for free. Please use the promo code **AINSIDER1872** at the Stripe checkout page.

## Promo code
- **Code:** `AINSIDER1872`
- **Benefit:** 3 months Webacy Pro free
- **Where:** Webacy Stripe checkout

## Planned integration surfaces (pre-grant plan)
1. Simulation Firewall — pre-sign Threat + Contract Risk
2. `/app/approvals` — Approval Risks sweep + revoke
3. Atlas token / wallet pages — Exposure + Threat risk badges
4. DACS agent proposals — Transaction Risk gating
5. Agent knowledge + Inbox — URL Risk scanning
6. Atlas token detail — Holder Analysis (invite-only, request via grant)

## Architecture
- `src/lib/webacy/client.ts` + Redis cache (Upstash)
- `src/app/api/webacy/[...path]/route.ts` server proxy
- `src/components/risk/RiskChip.tsx` shared UI primitive
- Secret: `WEBACY_API_KEY` (add on approval)
- Feature flag: `WEBACY_ENABLED`
