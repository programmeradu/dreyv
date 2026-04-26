---
name: Phantom Wallet Integration
description: Phantom Connect SDKs (React/Browser/RN/Server), MCP server, warning-avoidance playbook, domain verification, Auto-Confirm, Lighthouse assertions
type: feature
---

# Phantom Wallet Integration — Master Reference

> Source: https://docs.phantom.com/llms.txt (fetched 2026-04-26). Use this memory before touching any wallet/connector code or before launching to production. Goal: zero red banners on any Dreyv-originated interaction.

## 1. SDK Surface (pick the right one)

| SDK | Package | Use for | Notes |
|---|---|---|---|
| **React** | `@phantom/react-sdk` | Dreyv main app (Next.js 15) | `PhantomProvider` + `useConnect`, `useAccounts`, `useSolana`, `useEthereum`. Supports social login (Google/Apple), Phantom Login, mobile deeplink, extension. |
| **Browser** | `@phantom/browser-sdk` | Vanilla / non-React surfaces (e.g. embed widgets, iframes) | `createPhantom()` + `phantom.connect({ provider })`. |
| **React Native** | `@phantom/react-native-sdk` | Future Dreyv mobile | Google + Apple social login only (no extension/deeplink/Phantom Login on RN today). |
| **Server** | `@phantom/server-sdk` | Custodial/automated treasury actions | **Experimental — needs partnerships@phantom.com access**. Org ID + API private key + App ID. |
| **CLI / MCP** | `@phantom/cli`, `@phantom/mcp-server` | Dev workflows + AI agent wallet | MCP exposes 25 tools (sign, transfer, swap, perps) to Claude/Cursor. Useful for our own agent dogfooding. |

All client SDKs: 7-day active sessions, KMS-backed signing (TEE + HSM + threshold crypto + signed audit trails).

EVM embedded wallets are **"coming soon" (planned 2026)**. Today: Solana embedded works; EVM only via injected/extension. Plan accordingly.

## 2. Use Cases for Dreyv

1. **Primary user wallet** — replace/augment current `@solana/wallet-adapter` with `@phantom/react-sdk` for first-class Phantom UX + social login (lowers onboarding friction for non-crypto founders, matches Stitch-style premium feel).
2. **Embedded wallet for new signups** — Google/Apple → instant Solana wallet, no seed phrase. Pair with our SIWS auth.
3. **Solana Pay / Request Payment** — invoice + payroll capabilities can render Phantom-compatible payment URIs/QRs.
4. **SIWS auth** — already use SIWS; align with Phantom's recommended flow (`signMessage` + backend `tweetnacl` verify).
5. **Phantom MCP server** — give our research/treasury agents a real Phantom wallet for autonomous on-chain reads/writes (no fees on Phantom's swap path).
6. **Auto-Confirm contracts** — register Squads V4, Jupiter, Marinade, Kamino, Streamflow program IDs so recurring agent txs don't prompt each time.
7. **Solana Actions / Blinks** — render Dreyv vault/proposal actions inline on Twitter/X.
8. **Multi-chain readiness** — when EVM embedded ships, unlock unified treasury across Solana + Base + Ethereum + Polygon + Monad.

## 3. AVOIDING RED BANNERS — the playbook

There are **3 warning types** Phantom can show. Each has a concrete fix.

### 3a. New domain warning
> *"This domain is new or has not been reviewed yet. Proceed with caution."*

- Auto-shown for newly-detected domains; **disappears in a few days** after Phantom's review.
- **Action:** none required if it goes away within ~1 week. If it persists, file the [domain review form](https://docs.google.com/forms/d/1JgIxdmolgh_80xMfQKBKx9-QPC7LRdN6LHpFFW8BlKM/viewform).
- **Pre-launch:** verify `dreyv.com` (and `dreyv.app`, `dreyv.finance`) in Phantom Portal via DNS TXT record BEFORE first user load — this fast-tracks reputation.

### 3b. Transaction simulation warning ⚠️ MOST DANGEROUS
> *"This dApp could be malicious. Do not proceed unless you are certain it is safe."*

Triggers when Phantom **can't simulate** the tx successfully. **All four fixes are mandatory in our tx builders:**

1. **One signer per tx.** If multi-sig is needed, have Phantom sign first via `signTransaction` (NOT `signAndSendTransaction`), then collect other sigs out-of-band.
2. **Stay under Solana tx size limit.** Use **Address Lookup Tables** (versioned txs) when accounts > ~30. Already do this for Jupiter swaps — verify for Squads proposals + mass dispatch.
3. **Pre-simulate with `sigVerify: false`** on our own RPC (Helius) before sending to Phantom. If our sim fails, fix it; never let Phantom be the first to discover a failure.
4. **Don't pad txs with no-op or expired ix.** Always fresh `recentBlockhash`.

### 3c. Prediction market token burn warning
> Specific to burning prediction-market tokens. N/A for treasury, but if we ever touch Polymarket-like flows, contact Trust & Safety form.

### 3d. Bonus protections (Lighthouse + Auto-Confirm)
- **Lighthouse assertions** — embed runtime assertions in our agent-built txs (e.g. "balance must drop by exactly N", "this PDA must equal X") so Phantom's simulator can label them green-checked.
- **Auto-Confirm** — register our trusted programs in Phantom Portal so Squads/Jupiter/Marinade/Kamino/Streamflow proposals don't prompt repeatedly. Requires verified domain first.

## 4. Domain verification — pre-launch sequence (DO THIS FIRST)

1. Sign up at https://phantom.com/portal/.
2. Register **Dreyv** app → set production domain `https://dreyv.com`.
3. Add allowed origins: `dreyv.com`, `*.vercel.app` (preview), `dreyv.app`, `dreyv.finance`.
4. Get verification TXT record → add to Vercel DNS for each domain.
5. Wait for "Verified" badge in Portal.
6. Get App ID → store as `NEXT_PUBLIC_PHANTOM_APP_ID` in Vercel + `.env.local`.
7. Add `OG:image`, favicon, name, description in Portal (Phantom reads OG tags for dialog branding).
8. Register trusted contracts (Squads V4, Jupiter, Marinade, Jito, Blaze, Kamino, Meteora, Streamflow, Drift) → enable Auto-Confirm.

## 5. Code wiring (when Phase 7B/UX-pass starts)

```bash
bun add @phantom/react-sdk
```

Wrap the existing `Web3ProvidersContent` in `PhantomProvider` (alongside, not replacing, `@solana/wallet-adapter` for backwards compat with Solflare/Backpack/Torus). Phantom auto-registers via Wallet Standard so `useWallet()` will still see it; the React SDK adds the social-login + embedded-wallet path.

Order of providers (outer → inner): `NetworkProvider > PhantomProvider > ConnectionProvider > WalletProvider (adapter, with Phantom EXCLUDED to avoid double-registration) > WalletModalProvider > VaultProvider > Wagmi > QueryClient > RainbowKit > OnchainKit`.

## 6. Env vars to add

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_PHANTOM_APP_ID` | Public | Required by all client SDKs. **Dreyv App ID = `7eeb0207-f5c1-4841-a6a9-1a0501438d1a`** (issued in Phantom Portal 2026-04-26). |
| `PHANTOM_ORG_ID` | Server only | Server SDK (when approved) |
| `PHANTOM_API_PRIVATE_KEY` | Server only | Server SDK signing key |
| `ARTIFACT_SIGNING_SECRET` | Server only | Phase 7A — signs short-lived download URLs for `agent_artifacts`. Falls back to `JWT_SECRET`. |

## 7. Open questions to resolve before launch

- [ ] Domain verified for dreyv.com / dreyv.app / dreyv.finance?
- [ ] App ID set in Vercel?
- [ ] Auto-Confirm registered for: Squads V4, Jupiter v6, Marinade, Jito, Blaze, Kamino, Meteora, Streamflow, Drift?
- [ ] All tx builders pre-simulate with `sigVerify: false` on Helius?
- [ ] Multi-sig flows use `signTransaction` (not `signAndSendTransaction`) for first signer?
- [ ] All > 30-account txs use ALTs (versioned)?
- [ ] Lighthouse assertions added to agent-built txs?
- [ ] Server SDK access requested (`partnerships@phantom.com`) for autonomous treasury actions?
