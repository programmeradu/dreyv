---
name: always use real logos
description: Token/protocol/company logos must be real images (TokenAvatar with logo URL, official asset URLs). Never letter-circle or initial placeholders.
type: design
---
# Real logos only

- Tokens: render via `<TokenAvatar logo={...} symbol=... />` from `src/components/TokenAvatar.tsx`. The `logo` field is already populated on `useVault()` holdings (Helius/Jupiter metadata). Pass it through everywhere a token is shown — tables, pills, cards, command bar suggestions.
- Protocols / venues / DEXes / lending markets: use their official logo URL (DefiLlama icons, project CDNs). If unknown, use the protocol-resolver helpers in `src/lib/datafeeds/*` rather than inventing a placeholder.
- Companies / partners / connected services: use their real wordmark/icon asset (already present under `public/brand/` and existing `*-section.tsx` marketing components).
- NEVER use single-letter circles, initial avatars, generic emoji, or color-block placeholders for any of the above. The geometric sigil fallback inside `TokenAvatar` is the *only* acceptable fallback (and only when no logo URL exists).
- When seeding canvas blocks with token rows, ALWAYS forward `logo` in the payload so renderers can pass it to `TokenAvatar`.
