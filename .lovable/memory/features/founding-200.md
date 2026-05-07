---
name: Founding 200
description: First-200 signup program — grants Mini-equivalent access free; tracked on users table; live counter on /pricing
type: feature
---
# Founding 200

- Goal: keep `/pricing` tiers visible (Free / Mini $49 / Max $199) but auto-grant **Mini-equivalent access free** to the first 200 signups while design partners onboard.
- Storage: `users.is_founding_member` (bool) + `users.founding_number` (int 1..200, unique). Migration `0025_founding_members.sql`.
- Claim: `src/lib/founding/claim.ts` — `claimFoundingSlot(userId)` is idempotent and race-safe (unique index on `founding_number`). Called from `/api/auth/sync` on first sync for both SIWS + Neon paths.
- Tier gate: `getUserTier()` in `src/lib/agents/policy/tier-gate.ts` returns `mini` when `is_founding_member` is true and base tier is `free`. Never downgrades Max.
- Public status: `GET /api/founding/status` → `{ claimed, remaining, cap: 200, open }`. 30s s-maxage.
- UI: `src/components/pricing/FoundingRibbon.tsx` — slim violet ribbon above tier grid on `/pricing`. Hides itself when `open=false`. Solid violet only, no gradients.
- Paystack billing rails stay dormant for founding members — they keep Mini access without a subscription. After 200 cap, new signups are plain Free and must subscribe for Mini.
