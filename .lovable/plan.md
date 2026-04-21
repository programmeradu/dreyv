

# Studio Infrastructure Review

A complete audit of how Dreyv Studio works today — code generation, runtime, sandbox, connectors, models, wallets, contracts, and shipping — with concrete upgrade recommendations.

---

## 1. Code generation pipeline

**How it works today**
```text
PromptChat ──► /api/studio/plan ──► PlanStepper (clarify → plan → integrations)
        │
        └─► ArchitectEngine ──► /api/studio/generate-stream (SSE)
                                    │
                                    ├─► buildProviderChain(aiConfig)  ← BYOK + env fallbacks
                                    ├─► STUDIO_SYSTEM_PROMPT + Web3Context
                                    └─► streamProvider() → tokens
                            ▼
                   parseLLMResponse → { files, explanation } | { patches }
                            ▼
                   analyzeCode (static checks) → CORRECTING loop (≤3 attempts)
                            ▼
                   onFilesGenerated → Studio state
```

**Strengths**
- Self-correcting state machine (`IDLE → STREAMING → ANALYZING → CORRECTING → CLEAN/FAILED`) with rollback.
- Multi-provider chain (OpenAI / Groq / Google / Anthropic / Cloudflare / Ollama) with env fallbacks via `buildProviderChain`.
- Patch-mode (`replace_range`) supported alongside full-file regeneration.

**Gaps**
- Static analysis is shallow — only checks for default export, sandbox patterns, old import paths, raw `fetch()`. No type-check, no JSX validity, no unused-import detection.
- Streaming events surface only as raw text in chat — no inline “file added / file modified / fix attempt 2/3” cards like Lovable.
- Plan, clarify, generate, and correction all live in separate routes with no shared session id → impossible to resume or audit a build.

---

## 2. Sandbox & live preview runtime

**How it works today**
- `LivePreview.tsx` builds a single `srcDoc` HTML payload containing React 19 + Babel standalone + Tailwind CDN + a console hijack.
- `compileCode()` (`src/lib/runtime/compiler.ts`) uses **`@babel/standalone`** in-browser to transform TSX → JS with inline source maps.
- `window.__keystoneSDK` and `window.__ks_require` are injected into the iframe to satisfy `import { useVault } from '@keystone-os/sdk'`.
- The iframe runs with `sandbox="allow-scripts"` and talks back to the host via `postMessage` through `BridgeController` (registered in `LivePreview.setupBridge`).

**Strengths**
- Zero-server preview — fully client-side, no container spin-up cost.
- Bridge protocol (`packages/sdk/src/bridge.ts`) is well-typed: vault, fetch proxy, Lit, ACE, MCP, Jupiter, Yield, Gasless, Dreyv.
- Live token prices/logos and real wallet holdings are pre-injected so preview reflects production state.

**Gaps**
- **Babel-in-browser is slow** for multi-file apps; compile cost grows with file count.
- No HMR — every keystroke recompiles the entire `srcDoc` and reloads the iframe.
- Multi-file imports rely on a hand-rolled `__ks_require` shim — no proper module graph, no css-modules, no asset imports.
- Error overlay is just console logs — no source-mapped React error boundary surface in the preview itself.
- `LivePreview.tsx.bak` still in tree (dead code).

---

## 3. Bridge & SDK (`@keystone-os/sdk`)

- Host-injected `KeystoneBridge` interface with two methods: `call(method, params, timeout)` and `notify(method, params)`.
- Method registry: `BridgeMethods` (turnkey, proxy, lit, ACE, ZKSP, agent, MCP, SIWS, jupiter, yield, gasless, blink, tax).
- Hooks live in `packages/sdk/src/hooks/*` and call through `getBridge()` (set via `setBridge()` or `globalThis.keystoneBridge`).
- In-Studio, hosts use **stubs** (`bridge-stubs.ts`) — Jupiter quotes, ACE reports, etc. are mocked.

**Gap:** stubs and real Dreyv Gateway calls live side-by-side in `LivePreview` with no toggle — devs can’t test against real RPC/Jupiter from preview.

---

## 4. Connectors / Dreyv Gateway

- Frontend hook: `useDreyvConnections` → `/api/dreyv-gateway/connections` (list providers, link, unlink).
- Server registry: `src/lib/dreyv-gateway/providers.ts` — Helius, Jupiter, Birdeye, Marinade, Pyth, Resend, Telegram, Slack.
- Each provider has `secretFields`, `publicFields`, and an `operations` map that builds outbound `BuiltRequest`s.
- Mini-apps invoke connectors via `dreyv.invoke(provider, op, args)` → bridge → `/api/dreyv-gateway/invoke`.
- KeyWizardModal collects keys; secrets are stored server-side (never reach the iframe).

**Gaps**
- Provider list is hard-coded — no plugin loader, no per-org provider, no rate-limit/quota visualization.
- No “test connection” button after save — users discover bad keys at runtime.
- Operations are typed as raw objects; no schema → no autocomplete in generated code.

---

## 5. Models & BYOK

- `APIKeySettings.tsx` writes to localStorage; `aiConfig` is forwarded to `/api/studio/generate(-stream)`.
- `buildProviderChain` interleaves user’s BYOK key first, then env fallbacks (`GROQ_API_KEY`, `OPENAI_API_KEY`, etc.) so generation degrades gracefully.
- Default models per provider are centralized in `getDefaultModel()`.

**Gaps**
- No per-task routing (e.g. plan → cheap fast model, codegen → reasoning model, fixes → patch-tuned model).
- No cost/latency telemetry per build — users can’t see “this app cost $0.04 in tokens.”
- BYOK keys live in localStorage in plain text; should be stored encrypted in the DB (or at least IndexedDB + WebCrypto).

---

## 6. Wallet & treasury integration

- `Web3Providers` stacks: `NetworkProvider` → `ConnectionProvider` (Solana RPC) → `WalletProvider` (Solflare, Torus) → `WalletModalProvider` → `VaultProvider` → wagmi (mainnet/base/arb/polygon/bsc) → RainbowKit → OnchainKit.
- `useVault()` (SDK) reads tokens from `VaultContext`; LivePreview injects live wallet holdings via Helius DAS (`/api/helius/das/wallet-holdings`) plus Jupiter price API.
- Squads multisig (`@sqds/multisig`) used in `executeAction` → `createVaultTransaction` (mocked instructions for swap/transfer).
- Turnkey embedded wallet via bridge `turnkey.signTransaction` (mocked in preview).

**Gaps**
- **Build error in `web3-provider.tsx`**: `import { mainnet, base, arbitrum, polygon, bsc } from "wagmi/chains"` — wagmi v2 moved chains to `viem/chains`. This is currently breaking your build.
- Phantom/Backpack adapters not wired (only Solflare + Torus) — flagged in your strategy docs as a coverage gap.
- No “connect treasury” shortcut from Studio — devs paste wallet addresses manually.

---

## 7. Smart contract compilation

- `ContractEditor.tsx` + `/api/studio/compile-contract` handle `.rs` (Anchor) files.
- `solana-playground.ts` wraps the playground compile API; `compileProgram()` returns IDL + binary.
- No local toolchain — compilation is remote.

**Gaps**
- No deploy-from-Studio path; users still drop into CLI.
- No anchor-test or simulate-against-localnet UX.
- IDL not auto-piped into TypeScript bindings for the mini-app.

---

## 8. App build & ship pipeline

```text
keystone ship  (CLI)
   │
   ├─► [1/4] runGatekeeper  → security score (≥ threshold)
   ├─► [2/4] runBuild        → bundle to .keystone/dist
   ├─► [3/4] runPublish      → Irys/Arweave upload + sha256 codeHash
   └─► [4/4] runPublish      → Anchor `initialize_app` on Solana
                              + POST /api/studio/publish (registry sync)
```

- Auth modes for `/api/studio/publish`: bearer (CLI token), wallet signature (nonce + tweetnacl), or cookie session.
- Marketplace listing: `miniApps` table with `creatorShare`, `arweaveTxId`, `codeHash`, `securityScore`.
- In-Studio “Ship” button currently just calls `saveProject` → no parity with CLI.

**Gaps**
- Studio `Ship` does not run gatekeeper or upload to Arweave — mismatch with CLI.
- No build log streaming back into chat (gatekeeper findings, bundle size, cid).
- `keystone.lock.json` resolution happens at compile time but is not surfaced — devs can’t pin SDK versions from the UI.

---

## 9. UI states & animations

- ArchitectEngine emits state transitions but the UI only reflects 3 of them (idle / streaming / done).
- No skeleton for plan stage, no shimmer for file diff, no progress ring for correction attempts.
- PlanStepper is a full-screen overlay → breaks the new “preview-first” shell. (Already noted last turn.)

---

## Recommended improvement plan (phased)

### Phase 1 — Stop the bleeding (1 PR)
1. **Fix the wagmi import** in `web3-provider.tsx` — switch chains to `viem/chains` or pin `wagmi@^2` and use the right export. Unblocks the build.
2. Delete `LivePreview.tsx.bak`.
3. Add Phantom + Backpack wallet adapters.

### Phase 2 — Build transparency (chat as system of record)
4. Stream ArchitectEngine state transitions into the chat as inline cards: **Planning… / Generating App.tsx / Fixing 2 errors (attempt 2/3) / Done — 12.4 KB, $0.03**.
5. Inline PlanStepper into chat thread (no overlay).
6. Move BYOK from localStorage → encrypted DB (per-user), with a token usage chart.

### Phase 3 — Runtime upgrade
7. Replace Babel-standalone with **esbuild-wasm** for ~10× faster multi-file compiles.
8. Add a real React error boundary inside the iframe with source-mapped stack traces.
9. Implement true HMR by diffing files and only re-evaluating changed modules in the iframe (keep React state).

### Phase 4 — Connector + ship parity
10. Add **“Test connection”** action per provider in `KeyWizardModal` (calls a `verify_credentials` op).
11. Make Studio **Ship** button run the full CLI pipeline server-side (gatekeeper → build → Arweave → publish) with logs streamed into chat.
12. Per-task model routing + cost telemetry surfaced in the header status pill.

### Phase 5 — Smart contracts
13. Add Anchor test + localnet simulate from `ContractEditor`.
14. Auto-generate TS bindings from compiled IDL into the mini-app `App.tsx` workspace.

---

## Files most likely to change

- `src/components/providers/web3-provider.tsx` (fix build)
- `src/lib/runtime/compiler.ts` (Babel → esbuild-wasm)
- `src/lib/studio/architect-engine.ts` (richer state events)
- `src/components/studio/PromptChat.tsx` (inline plan + activity cards)
- `src/components/studio/PlanStepper.tsx` (de-overlay)
- `src/components/studio/LivePreview.tsx` (HMR, error boundary, real/stub toggle)
- `src/components/studio/KeyWizardModal.tsx` (test connection)
- `src/app/api/studio/publish/route.ts` + new `/api/studio/ship` (UI ship parity)
- `src/lib/studio/ai-provider.ts` (per-task routing + telemetry)

---

**Recommended order to start:** Phase 1 (build fix) immediately, then Phase 2 (chat-as-system-of-record) — that’s the work most aligned with the Lovable-style UX you’ve been pushing toward.

