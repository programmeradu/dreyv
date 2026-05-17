# Smart Block Explorer — `/v/[address]` v2

Turn the public read-only vault preview into the smartest wallet explorer on Solana + EVM. Ships in 4 tiers, each independently shippable. All UI follows the existing Stitch-light violet aesthetic (white bg, Manrope, `violet-600`, ambient violet-300/400 glows, `violet-200` borders, flat CTAs — no gradients, no fuchsia, no dots/Sparkles).

---

## Architecture overview

```text
/v/[address]                       # SSR shell (already exists, extend)
  ├─ PublicVaultClient (existing, extended)
  └─ new sections (lazy-loaded server components where possible)

/api/public/                       # NEW namespace — soft-rate-limited, no-auth
  ├─ narrative/[address]           # Lovable AI streaming summary
  ├─ archetype/[address]           # rule-based classifier
  ├─ counterparties/[address]      # top 10 in/out + label resolver
  ├─ suggestions/[address]         # "What Dreyv would do" — 3 ideas
  ├─ pnl/[address]                 # cost-basis per holding
  ├─ performance/[address]?range=  # USD value over time vs SOL bench
  ├─ risk/[address]                # HHI + concentration + hygiene
  ├─ activity/[address]            # semantic, grouped tx feed
  ├─ siblings/[address]            # cluster heuristic
  ├─ nfts/[address]                # collections + cNFT roll-up
  ├─ token/[mint]                  # drill-in (chart, liq, holders, rug)
  └─ resolve/[handle]              # .sol / ENS / SNS → address

/v/[address]/opengraph-image.tsx   # NEW edge OG (narrative + top stat)
/v/[handle]                        # NEW resolver route (catches *.sol / *.eth / 0x…)
/v/[address]/route.ts? → .json     # NEW machine-readable mirror
                                   # served as /v/[address].json via rewrite

supabase/functions/                # Lovable AI lives here (per memory rule)
  ├─ public-narrative/             # streams archetype + narrative
  └─ public-suggestions/           # streams 3 actions
```

Realtime ("Live mode") uses a Helius webhook → Supabase Realtime channel keyed by address; the client subscribes and animates new tx pills in with a violet pulse.

---

## Tier 1 — "Why would I go back to Solscan?"

### 1. AI narrative header (streaming)
- Replace the static "Read-only preview" subtitle with `<NarrativeHeader address={...} />`.
- Client calls Supabase edge function `public-narrative` (Lovable AI, `google/gemini-3-flash-preview`), passes a pre-computed feature pack (age, balance shape, top protocols, 30d delta, last meaningful action — built server-side from Helius enhanced history + DAS).
- AI returns one paragraph max, Dreyv brand voice (calm, founder-to-founder, no banned words).
- Stream into the DOM with framer-motion. Violet caret while streaming.

### 2. Archetype tag
- Pure-TS classifier in `src/lib/explorer/archetype.ts`. Inputs: wallet age, # signers, multisig flag, % SOL/USDC/LST, swap-to-transfer ratio, % to CEX hot wallets, # unique counterparties, avg tx size.
- Output: `DAO Treasury | Market Maker | Active Trader | Retail | Sniper | Bridge Hot | CEX Deposit | Long-term Holder | New Wallet`.
- Renders as a small violet pill next to the header.

### 3. Counterparty graph (top 10 in / out)
- Aggregate last ~1k Helius enhanced txs, sum native + SPL transfers per counterparty.
- Resolve labels via: existing `solana-labels` JSON (Jupiter, Kamino, Marinade, Squads, Wintermute, Binance/OKX/Coinbase hot wallets), Squads multisig member lookup, fallback to truncated address.
- Two columns "In" / "Out", each row = avatar (protocol logo or generated identicon) · label · USD volume · count. Click → `/v/<that address>`.

### 4. "What Dreyv would do" panel
- 3 cards. Sources:
  - Idle SOL > 5 → "Stake X SOL → +$Y/yr" using current Marinade/Jito APR.
  - >3 empty token accounts → "Consolidate N dust accounts → reclaim X SOL rent".
  - Idle USDC > $500 for >30d → top yield from `/api/yield/rates` filtered to stables.
- Each card has a flat violet CTA → `/waitlist?from=v&addr=...`.
- No suggestion shown if data doesn't support it. Never fabricate.

---

## Tier 2 — Explorer table-stakes, done better

### 5. PnL & cost basis per holding
- New `/api/public/pnl/[address]` server route.
- For each holding: pull all inbound transfers from Helius, weight by Jupiter historical price at `blockTime` (use Jupiter Price API v2 historical), compute weighted avg entry. Current price already in holdings payload.
- Render under each holding row: `+$3,412 (+24%) · avg $142`. Color: violet for up, slate for down (no green/red — memory rule).

### 6. 30/90/365d performance chart
- `/api/public/performance/[address]?range=30|90|365` — daily snapshots of USD value reconstructed from balance + Jupiter daily close.
- Cache aggressively (R2 daily key per address+range).
- Recharts line, single violet stroke, SOL benchmark as `violet-300` dashed line. Stream in via framer-motion path draw.

### 7. Concentration & risk score
- Score 0–100. HHI on USD weights × 0.4 + unverified-token % × 0.2 + single-protocol % × 0.2 + multisig hygiene (already in `/api/treasury/security`) × 0.2.
- Big number, click → expandable breakdown of each factor.

### 8. Recent activity timeline (semantic)
- Replace fee table style with grouped timeline. Each group = one logical action ("Swapped 5k USDC → JUP on Jupiter") synthesized from Helius enhanced tx `description` + protocol detection.
- Protocol logos via existing `@/lib/protocol-logos`. No raw signatures unless expanded.

---

## Tier 3 — Moat

### 9. Sibling wallets
- Heuristic in `src/lib/explorer/siblings.ts`:
  - Shared funding wallet (first inbound funder).
  - Same Squads multisig membership.
  - Repeated co-signing on the same multisig tx.
- Returns ≤ 5 candidate addresses with confidence. Render as compact strip: "Likely linked to N wallets · combined $X".

### 10. NFT + compressed asset section
- Helius DAS `getAssetsByOwner` with `showFungible:false`. Group by `grouping.collection`, fetch floor from Tensor/ME public endpoint.
- Collapsed by default; expand → grid of thumbnails.

### 11. Token-level drill-in
- `/v/[address]?token=<mint>` opens a Sheet (shadcn) on top of the page:
  - 7d price chart (Jupiter), liquidity depth (Jupiter quote @ 1/10/100k), top holders (Helius `getTokenLargestAccounts`), rug score (existing Atlas `/api/atlas/rug/[mint]`).

### 12. Live mode
- Helius webhook `addressActivity` → existing webhook route → broadcast on Supabase Realtime channel `public-vault:<address>`.
- Client `supabase.channel(...)` subscribes; on event, prepend a pill to activity with `animate-pulse` violet ring for 2s.
- Toggle in header: "Live · paused".

### 13. Shareable OG image
- `src/app/v/[address]/opengraph-image.tsx` using Next `ImageResponse`. Card: Dreyv mark, truncated address, archetype, USD total, 30d sparkline (rendered server-side as SVG path string), the narrative's first sentence. Violet bg accents.
- `generateMetadata` already wired — extend to set `openGraph.images` to the route.

### 14. `?compare=<addr2>` side-by-side
- When param present, fetch the same data set for both addresses in parallel and render a 2-col diff: holdings, archetype, risk, 30d perf, top protocols. Header becomes "A vs B".

### 15. Embed mode `?embed=1`
- Strip Dreyv top bar, footer, glow header. Render compact card-only layout (~480×640). Add tiny "Powered by Dreyv" badge linking back. Allow `X-Frame-Options: ALLOWALL` for this query.

### 16. EVM parity
- Detect address shape in `/v/[address]/page.tsx`: if `0x[40-hex]`, route to `EvmVaultClient` using existing `alchemyFeed` + `covalentFeed`. Reuse narrative/archetype/risk pipelines (chain-agnostic feature pack).
- Drop Solana-only sections (multisig, cNFTs, Squads) when on EVM, swap in chain selector (Ethereum / Base / Arbitrum / Polygon / BSC).

---

## Tier 4 — Distribution

### 17. `/v/[address].json` + llms.txt
- Add `src/app/v/[address].json/route.ts` returning the full feature pack as stable JSON.
- Add a section to `public/llms.txt` documenting the `/v/{address}` and `/v/{address}.json` endpoints so LLM crawlers cite Dreyv.

### 18. Vanity / ENS / SNS / .sol resolution
- `/v/[handle]` server resolver:
  - `.sol` → Bonfida SNS (public RPC).
  - `.eth` → ENS via Alchemy/ethers public resolver.
  - Else 404 unless valid base58 / 0x.
- 301 to canonical address URL.

### 19. "Claim this wallet" CTA
- Sticky bottom-right card on `/v/[address]` (hidden in embed mode): "Is this your wallet? Claim it →".
- Click → `/auth?claim=<addr>`. On post-auth, the app pre-loads history for that address (write into `users.claimed_addresses` jsonb on first login).

---

## Build order (strategic — value early, infra reused)

**Sprint A — Brain & narrative** (unlocks 1, 2, 4, 8, 13, 17)
- Feature-pack builder in `src/lib/explorer/feature-pack.ts` (age, balance shape, counterparties, deltas, last meaningful action) — used by everything downstream.
- `supabase/functions/public-narrative` + `public-suggestions` edge functions.
- Archetype classifier (#2), narrative header (#1), suggestions panel (#4), semantic activity (#8), `.json` mirror (#17), OG image (#13).

**Sprint B — Numbers** (5, 6, 7)
- Cost basis worker, performance snapshot route + R2 cache, risk score component.

**Sprint C — Graph & drill** (3, 9, 10, 11)
- Counterparty + sibling heuristics share the same enhanced-tx scan → build once.
- NFTs + token sheet.

**Sprint D — Reach** (12, 14, 15, 16, 18, 19)
- Live mode (webhook + realtime), compare, embed, EVM parity, handle resolver, claim CTA.

---

## Technical notes

- **No new tables required for v1** of Tier 1–3 — everything reads from Helius/Jupiter/existing APIs and caches in R2.
- For Sprint D #19 we need one column: `users.claimed_addresses jsonb default '[]'::jsonb`.
- For Sprint D #12 Realtime: enable on a lightweight `public_address_events` table that the Helius webhook inserts into; clients subscribe by `address` filter. RLS = public-read.
- All Lovable AI calls go through Supabase edge functions (memory rule).
- Rate-limit `/api/public/*` to 30 req/min/IP in middleware to protect the brand-new endpoints.
- No fabricated numbers anywhere. Every panel must either render real data or render nothing (or a clarify CTA).
- Reuse `TokenAvatar`, `DreyvStar`, `marketingPrimaryCta`, protocol-logos. No Sparkles/Zap, no green/red, no gradients.

---

## Out of scope for this plan

- Authenticated app-side ("/app") rewrites — this is `/v/*` only.
- Multi-chain beyond the 5 EVM chains already wired (`alchemy.ts`).
- Historical chart granularity finer than daily.
