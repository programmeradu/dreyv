# dreyv-cron-runner

Cloudflare Worker that owns Dreyv's sub-daily cron heartbeats. Vercel Hobby
caps cron at once per day, so this Worker fires the three jobs that need to
run more often:

| cron expression | Vercel route                | cadence        |
| --------------- | --------------------------- | -------------- |
| `*/15 * * * *`  | `/api/cron/anomaly-alerts`  | every 15 min   |
| `15 * * * *`    | `/api/cron/agent-insights`  | every hour :15 |
| `30 * * * *`    | `/api/cron/opportunities`   | every hour :30 |

Daily/weekly/monthly jobs (welcome, weekly digest, monthly report, vault
commands, approval nudges, upgrade nudges, reengagement, onboarding drip)
stay on Vercel — see `vercel.json` at the repo root.

## How it works

`src/worker.ts` exports a `scheduled` handler. Each cron expression in
`wrangler.toml` lands there with `event.cron` set to the firing expression.
A small route table maps cron → Vercel path, and the Worker calls the route
with `Authorization: Bearer ${CRON_SECRET}`.

The Vercel routes already verify that header via `src/lib/cron-auth.ts`, so
no server-side changes are needed — the Worker reuses the same secret Vercel
itself uses.

## Deploy

```bash
cd workers/cron-runner
npm install
wrangler login                                # one-time
wrangler secret put CRON_SECRET               # paste same value as Vercel CRON_SECRET
npm run deploy
```

After deploy the cron schedules are live. Verify in the Cloudflare dashboard
under **Workers & Pages → dreyv-cron-runner → Triggers → Cron Triggers**, or
check logs with:

```bash
wrangler tail dreyv-cron-runner
```

## Required env / secrets

| name             | type   | where                          | example                           |
| ---------------- | ------ | ------------------------------ | --------------------------------- |
| `DREYV_BASE_URL` | var    | `[vars]` in `wrangler.toml`    | `https://dreyv.stauniverse.tech`  |
| `CRON_SECRET`    | secret | `wrangler secret put`          | matches Vercel's `CRON_SECRET`    |

## Operational endpoints

- `GET /health` — returns `{ ok, service, baseUrl, crons, secretConfigured }`. Use to confirm a deploy.
- `GET /trigger/<cron>?key=<CRON_SECRET>` — manually fire one of the three jobs (URL-encode the cron expression). Useful for ops/debugging without waiting for the next tick.

## Why a separate Worker (not the existing `treasury-agent`)

`treasury-agent` is a Durable-Object-per-user runtime — different lifecycle,
different bindings, different deploy cadence. Mixing cron triggers there
would couple two unrelated concerns. This Worker has zero bindings beyond the
shared secret and is intentionally trivial to reason about.

## Cost / limits

Cloudflare cron triggers are billed as Worker invocations. Three cron
expressions that fire `*/15` + hourly + hourly = ~144 invocations/day per
Worker. Well within Free, trivial on Enterprise.
