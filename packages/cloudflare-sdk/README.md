# @dreyv/cloudflare

Unified Cloudflare SDK for Dreyv autonomous treasury agents and Mini-Apps.

Wraps the parts of Cloudflare's platform that Dreyv actually uses in production:

| Module | Purpose |
| --- | --- |
| `@dreyv/cloudflare/browser` | Browser Rendering REST API — screenshot, PDF, markdown, scrape, multi-page crawl |
| `@dreyv/cloudflare/workers-ai` | Workers AI inference — chat completions, embeddings, image generation, model probing |
| `@dreyv/cloudflare/kv` | Cloudflare KV REST API — key/value store with TTL + metadata |
| `@dreyv/cloudflare/d1` | D1 SQLite REST API — query/exec with parameterised SQL |
| `@dreyv/cloudflare/r2` | R2 object storage REST API — put/get/delete/list with signed URLs |
| `@dreyv/cloudflare/agents` | Cloudflare Agents (Durable Object) helpers — agent runtime client + state hooks |

## Install

```bash
npm install @dreyv/cloudflare
```

## Configure

All modules read these environment variables (or accept an explicit config object):

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_AI_TOKEN` — API token with the relevant module permissions

Per-module bindings (KV namespace ID, D1 database ID, R2 bucket name, Agents script name) are
passed at call time so a single token can serve many resources.

## Quick start

```ts
import { browser, workersAi, kv, d1, r2, agents } from "@dreyv/cloudflare";

// Headless browser
const md = await browser.markdown({ url: "https://docs.dreyv.app" });

// Workers AI chat
const reply = await workersAi.chat({
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  messages: [{ role: "user", content: "summarise: " + md.slice(0, 2000) }],
});

// KV
await kv.put({ namespaceId: "abc", key: "summary:dreyv-docs", value: reply.text, ttlSeconds: 3600 });

// D1
await d1.exec({
  databaseId: "xyz",
  sql: "INSERT INTO summaries (slug, body) VALUES (?1, ?2)",
  params: ["dreyv-docs", reply.text],
});

// R2
await r2.put({ bucket: "dreyv-artifacts", key: "summaries/dreyv-docs.md", body: reply.text });

// Agents (Durable Object)
const agent = agents.client({ scriptName: "treasury-agent", instanceName: "vault-001" });
await agent.send({ kind: "tick" });
```

## Why a separate SDK?

Dreyv's autonomous agents need a single, typed, retry-aware Cloudflare client.
Inlining REST calls (`fetch` + auth headers) per route is the bug factory we are leaving behind.
This package centralises auth, error envelopes, retry/backoff, and pagination so the
agent loop, Mini-Apps, and the marketplace SDK all consume the same surface.
