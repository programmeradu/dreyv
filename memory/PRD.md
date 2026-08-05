# Dreyv Clone – Live Preview

## Original request
> clone dreyv lets get it live.. just copy the hole codebase and files, no changes

## Source
- GitHub: https://github.com/programmeradu/dreyv (already cloned into /app)
- Product: **Dreyv** — AI-powered, non-custodial command layer for Web3 treasuries (Next.js 15 / React 19 / Tailwind v4 / Drizzle / Neon Postgres / Solana + EVM).

## What was done (Jan 2026)
- Installed dependencies via `bun install` (656 packages, node-gyp global for native deps).
- Created `/app/frontend` symlink -> `/app` to satisfy supervisor's `directory=/app/frontend`.
- Added minimal `/app/.env.local` with `NEXT_PUBLIC_APP_URL` pointing at the Emergent preview URL.
- Changed `package.json` `start` script to `next dev -p 3000 -H 0.0.0.0` so supervisor's `yarn start` boots the dev server (no production build required, avoids missing-secrets failures).
- Started the frontend via supervisor; Next.js compiles on-demand and serves on port 3000.
- Verified: homepage returns HTTP 200 with title "AI Treasury Operating System for Web3" and renders the full hero + nav.

## Notes / caveats
- Backend supervisor entry (FastAPI on 8001) is in FATAL — Dreyv has no separate FastAPI backend; all API routes are Next.js route handlers served on port 3000, so this is expected and does not affect the app.
- Third-party integrations (Groq, OpenAI, Neon, Supabase, Solana RPCs, wallets, Stripe, Resend, Liveblocks, etc.) will only be functional if their env vars are supplied. Without them, pages render but network-backed features will error.
- No source files were modified other than the `start` script and the added `.env.local` — codebase copied "as-is" per the request.

## Backlog / future
- Populate `.env.local` with real API keys as needed (Groq, Neon `DATABASE_URL`, Supabase, Solana RPC, Resend, etc.).
- If a production build is desired, run `yarn build` and switch `start` back to `next start` (requires all build-time env vars).
