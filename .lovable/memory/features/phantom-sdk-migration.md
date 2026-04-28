---
name: Phase 12 — Phantom SDK migration
description: Migrate from @solana/wallet-adapter to @phantom/react-sdk + embedded wallets. Surface, strategy, traps.
type: feature
---

## Goal
Replace the brittle `@solana/wallet-adapter-*` ecosystem with Phantom's first-party SDK so we get:
- Embedded wallets (Google/Apple/email onboarding for non-crypto treasury users)
- Maintained packages (Torus's broken `base64url` was the trigger)
- Multi-chain (Solana + EVM) via one provider
- Aligned with our Phantom MCP / Phantom-first roadmap

## Surface area (audited)
- 46 files import `@solana/wallet-adapter-*` or call `useWallet()`.
- Critical hubs: `src/components/providers/web3-provider.tsx`, `solana-provider.tsx`, `useSquadsMultisig`, `use-wallet-transaction`, `transaction-executor`, `auth/page.tsx` (SIWS).
- All 46 callsites consume one of: `publicKey`, `connected`, `signTransaction`, `signAllTransactions`, `signMessage`, `sendTransaction`, `disconnect`.

## Migration strategy (two-track, not a big-bang)
Phantom embedded SDK auto-publishes a **Wallet Standard** provider on `window`, so existing `@solana/wallet-adapter-react` code continues working — embedded wallet just shows up as another connectable wallet alongside Phantom extension/Backpack/Solflare.

That means we can split the work:

### Track A — Drop in Phantom embedded (1–2 files, low risk)
1. `npm i @phantom/wallet-sdk` (NOT react-sdk yet).
2. In `web3-provider.tsx`, call `createPhantom({ namespace: "dreyv", hideLauncherBeforeOnboarded: true })` once on client mount.
3. Wallet Standard auto-discovery in `WalletProvider` picks it up — no callsite changes.
4. Add `NEXT_PUBLIC_PHANTOM_APP_ID` from phantom.com/portal.
5. Verify: extension users unaffected; non-extension users see Phantom embedded option in the modal.

### Track B — Full migration to @phantom/react-sdk (later, scoped)
Only do this when we want the richer hooks (`useSolana`, `useEthereum`, themed `<ConnectButton>`):
1. Wrap app in `PhantomProvider` alongside (then replacing) `WalletProvider`.
2. Build a thin compat shim `useWalletCompat()` that maps `usePhantom() → { publicKey, signTransaction, … }` so the 46 callsites change zero behavior.
3. Migrate callsites in waves: providers → hooks → leaf components.
4. Remove `@solana/wallet-adapter-*` packages last.

## Traps to avoid
- **SIWS in `auth/page.tsx`** — Phantom embedded supports `signMessage`; verify the message format matches our `lib/auth/server.ts` verifier before swapping.
- **Squads multisig** — `@sqds/multisig` calls `signAllTransactions`; embedded supports it but test partial-signing flows.
- **Namespace** — if we want embedded + extension active simultaneously, MUST pass `namespace` to `createPhantom`.
- **Iframe** — embedded wallet renders in an iframe; CSP / `frame-src` headers in `next.config.ts` and middleware may need to allow `https://*.phantom.app`.
- **Redirect URL** — register `https://dreyv.com/auth/callback` and localhost equivalents in Phantom Portal exactly (http vs https matters).

## Required env
- `NEXT_PUBLIC_PHANTOM_APP_ID`
- `NEXT_PUBLIC_REDIRECT_URL` (e.g. `https://dreyv.com/auth/callback`)

## Status
Planned. Not started. Pick Track A first to ship onboarding wins without touching 46 files.
