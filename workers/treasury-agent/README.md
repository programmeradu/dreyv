# dreyv-treasury-agent (Cloudflare Worker + Durable Object)

This is the Cloudflare-hosted half of the Dreyv hybrid agent system.

- **Inngest (Vercel)** — runs the durable workflows: opportunity router (Groq triage → Gemini deep), tx reconciler, watcher sweeps. Best at "this must complete with retries and observability."
- **Cloudflare Workers + Durable Objects (this worker)** — runs **one DO instance per Dreyv sub-agent**, each with its own private storage, alarm clock, and message inbox. Best at "this agent needs persistent memory, sub-second reaction, and isolation from every other agent."

## What each DO instance is

```
TREASURY_AGENT.idFromName("subagent:${subagentId}")  →  one DO
TREASURY_AGENT.idFromName("user:${userId}")          →  one DO (per-user shared memory)
TREASURY_AGENT.idFromName("vault:${vaultAddress}")   →  one DO (per-vault state)
```

Cloudflare guarantees every request to that name lands on the **same instance worldwide**, with the **same private storage**, until you explicitly reset/delete it. State survives Worker redeploys.

## Memory each agent keeps

| Key | Purpose |
|-----|---------|
| `meta` | goal, userId, walletAddress, createdAt, ttlExpiresAt, tickIntervalMs |
| `log` | last 100 messages received (full audit trail) |
| `decisions` | last 50 decisions the agent made |
| `cooldowns` | per-op unlock-at timestamps (avoid spamming) |
| `positions` | agent's own view of the wallet (mint → balance) |
| `stats` | ticks, opportunitiesEmitted, alertsSent, lastTickAt |

## Endpoints (called by the Dreyv brain on Vercel)

```
POST /agent/:instanceName/message    → send a message to the agent
GET  /agent/:instanceName/state      → read full memory snapshot
POST /agent/:instanceName/reset      → wipe memory and stop alarms
```

Auth: include header `x-dreyv-agent-key: $DREYV_AGENT_KEY` (must match the
secret set via `wrangler secret put DREYV_AGENT_KEY`).

## Message kinds

```ts
{ kind: "init",     payload: { goal, userId, walletAddress, ttlMinutes? } }
{ kind: "tick"   }                                 // run a reasoning pass now
{ kind: "observe", payload: { type, mint?, amount?, urgent? } }
{ kind: "instruct", payload: { text } }            // user gives the agent new context
{ kind: "shutdown" }                                // wipe + stop
```

## Self-wake

The agent calls `state.storage.setAlarm(now + tickIntervalMs)` after every
tick. Cloudflare invokes `alarm()` at that exact time — no external cron
required. This is the key autonomy unlock vs the current Inngest cron model.

## Deploy

```bash
cd workers/treasury-agent
npm install
wrangler login
wrangler secret put DREYV_AGENT_KEY      # paste a long random string; also set in Vercel env
wrangler deploy
```

Note the deployed URL (e.g. `https://dreyv-treasury-agent.your-subdomain.workers.dev`)
and set it as `DREYV_AGENT_WORKER_URL` in Vercel env. The brain will use it
to address agents.

## Local dev

```bash
wrangler dev
# → http://localhost:8787/agent/subagent:test/message
```
