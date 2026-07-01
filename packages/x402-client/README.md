# @dreyv/x402-client

Drop-in buyer SDK for the [x402](https://x402.org) protocol — the open standard for `HTTP 402 Payment Required` that lets AI agents pay per API call in stablecoins.

**What this gives your agent:**

- A **wallet** (custodial USDC on Solana, auto-provisioned)
- A **budget** (per-call and per-run hard caps you set)
- An **audit trail** (every payment returned as a structured receipt with a Solscan link)

Works against any x402-compliant seller — Cloudflare Monetization Gateway origins, Dreyv SKUs, Coinbase-facilitated APIs, self-hosted endpoints. The SDK never holds keys; Dreyv's facilitator signs on the agent's behalf, so it's safe to ship inside untrusted agent runtimes.

## Install

```bash
npm i @dreyv/x402-client
```

## Quick start

```ts
import { DreyvX402Client } from "@dreyv/x402-client";

const dreyv = new DreyvX402Client({
  apiKey: process.env.DREYV_API_KEY!, // dk_live_… or dak_…
  maxPricePerCallUsd: 0.25,
  budgetUsd: 5,
});

const res = await dreyv.fetch("https://api.some-seller.com/premium/report", {
  method: "POST",
  body: { symbol: "SOL" },
});

console.log(res.upstream.body);
console.log(res.payment?.explorer); // solscan tx link, if paid
console.log("spent so far:", dreyv.spent);
```

If the seller returns `200`, you get the response for free. If they return `402`, the SDK negotiates the cheapest Solana USDC quote below your cap, settles on-chain, retries with `X-PAYMENT`, and returns the fulfilled body plus a receipt. If the quote exceeds your cap, the SDK throws instead of paying.

## Get an API key

Sign up at [dreyv.com](https://dreyv.com) → **Developer** → **API Keys**. New keys get a $0.25 starter grant so your first calls just work.

## Docs

- Protocol: <https://x402.org>
- Dreyv facilitator: <https://dreyv.com/x402>
- Auth format: <https://dreyv.com/auth.md>
