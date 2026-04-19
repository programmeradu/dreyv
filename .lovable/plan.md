

User wants the launch refinements but with restraint — clean, dispersed, not crowded. Need to revise the plan to emphasize spatial discipline: one signal per surface, progressive disclosure, no badge stacking. Keep it tight.

---

# Atlas Launch Plan — Clean & Dispersed

Guiding rule: **one primary signal per surface**. Everything secondary lives behind hover, click, or a dedicated panel. No widget gets more than one badge at rest.

## Layout discipline (applies everywhere)

- **Max one chip/badge visible per card at rest.** Methodology, timestamps, source — all collapse into a single subtle "ⓘ" that opens a popover.
- **Whitespace over borders.** Remove redundant dividers between widgets that already have spacing.
- **Header stays single-row.** No second status strip — health & freshness fold into existing right-rail dots.
- **Mobile = single column, generous padding.** No horizontal scroll except the ticker.

## Phase 1 — Launch-blocking polish

1. **Unified info popover pattern**  
   Every actionable widget (rug, MEV, airdrop, swap, time machine) gets one small "ⓘ" in the header. Click reveals: methodology link, data freshness, disclaimer. Replaces 3+ scattered labels with one.

2. **Header right-rail consolidation**  
   Current ticker has TPS chip + bell + wallet chip. Keep: bell + wallet. Move TPS into a single status dot beside the logo (green/amber/red, hover shows TPS + slot). Frees visual space.

3. **Ticker hierarchy fix**  
   One marquee, but visually grouped: prices use mono numerals only (no extra labels), news gets a tiny colored dot prefix instead of a source pill. Slower scroll (120s).

4. **Remove placeholders & duplicates**  
   - Audit `atlas-client.tsx` for "coming soon" / stub widgets → delete or hide  
   - Pick one canonical price display (recommend: ticker only; remove duplicate price row in Market Pulse if redundant)  
   - Hide `lp_sol_usdc` strategy if not shippable

5. **Error & empty states**  
   Replace generic toasts with inline, quiet messaging inside the affected card. No global banners.

6. **Mobile pass at 375px**  
   Single column, sticky bottom CTA on swap, ticker remains.

## Phase 2 — Launch-week additions (each lives in its own surface, not bolted on)

7. **Command bar intent echo**  
   After parse, show a single confirmation line *inside the hero pill* (replaces input briefly): "Swap 1 SOL → USDC · confirm or edit". No new chip, no new card.

8. **"For You" panel — replaces Market Pulse when wallet connected**  
   Same slot, different content. Top 3 holdings, one risk alert, one opportunity. Three lines max. No badges.

9. **Quota indicator — sidebar footer only**  
   Single line: "47 / 100 today". Click opens upgrade. Nothing in the main canvas.

10. **Keyboard overlay (`?`)**  
    Pure modal, no persistent UI. Discoverability without clutter.

## Phase 3 — Post-launch (separate routes, not crammed in)

11. **Shareable snapshots** — one icon-only button per widget header, opens dedicated `/atlas/share/[id]` route  
12. **Strategy presets** — dedicated `/atlas/presets` page, not a row above the swap  
13. **Watchlist** — collapsible left-rail section, not a new widget

## What gets removed

- Duplicate price displays across hero / market pulse / ticker → keep ticker as canonical
- "Coming soon" placeholders
- Any widget without a clear answer to "what decision does this enable?"
- Redundant borders/dividers between already-spaced cards
- Multi-badge footers (replaced by single ⓘ popover)

## Build-error note

The current build is failing (`dist-check` exit 1) — likely leftover from the recent ws/bn.js/uuid type fixes. Phase 1 starts with a build verification before any UI work.

---

## Execution order

Approve and I'll start Phase 1, beginning with the build fix, then the info-popover pattern (which alone removes most visual clutter across widgets). Tell me if you want to drop, add, or reorder anything.

