/**
 * Dreyv Cron Runner — Cloudflare Worker
 *
 * Vercel Hobby caps cron jobs at once per day. Three Dreyv jobs need to fire
 * more often (anomaly detection in particular needs minutes-grade response),
 * so this Worker owns those heartbeats and the daily/weekly/monthly ones stay
 * on Vercel.
 *
 * Each cron expression in wrangler.toml's `[triggers] crons = [...]` maps to
 * one Vercel route. The dispatch table below is the single source of truth —
 * if you change a schedule, change it in BOTH this map AND wrangler.toml.
 *
 * Auth: every Vercel /api/cron/* route already calls verifyCron(), which
 * checks `Authorization: Bearer ${CRON_SECRET}`. We set the same CRON_SECRET
 * as a Worker secret (`wrangler secret put CRON_SECRET`) so the Worker can
 * call those routes without any server-side changes.
 */

export interface Env {
  DREYV_BASE_URL: string;
  CRON_SECRET: string;
}

// cron expression → Vercel cron route config. Keep in sync with wrangler.toml.
interface RouteConfig {
  path: string;
  method?: string;
  action?: string;
}

const ROUTES: Record<string, RouteConfig> = {
  "*/15 * * * *": { path: "/api/cron/anomaly-alerts" },
  "15 * * * *": { path: "/api/cron/agent-insights" },
  "30 * * * *": { path: "/api/cron/opportunities" },
  "*/1 * * * *": { path: "/api/internal/background", method: "POST", action: "1m_pulse" },
  "*/2 * * * *": { path: "/api/internal/background", method: "POST", action: "jitoMevPoll" },
  "*/5 * * * *": { path: "/api/internal/background", method: "POST", action: "txProposalReconciler" },
  "*/10 * * * *": { path: "/api/internal/background", method: "POST", action: "txProposalReaper" },
  "0 * * * *": { path: "/api/internal/background", method: "POST", action: "reflect1h" },
};

async function dispatch(cron: string, env: Env): Promise<void> {
  const routeConfig = ROUTES[cron];
  if (!routeConfig) {
    console.error("[cron-runner] unmapped cron expression", { cron });
    return;
  }
  const { path, method = "GET", action } = routeConfig;
  if (!env.CRON_SECRET) {
    console.error("[cron-runner] CRON_SECRET secret not set — refusing to fire", { cron, path });
    return;
  }
  const base = env.DREYV_BASE_URL?.replace(/\/+$/, "");
  if (!base) {
    console.error("[cron-runner] DREYV_BASE_URL var not set — refusing to fire", { cron, path });
    return;
  }
  const url = `${base}${path}`;
  const startedAt = Date.now();
  try {
    const fetchInit: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
        "User-Agent": "dreyv-cron-runner/1.1 (+cloudflare-worker)",
      },
    };
    if (method === "POST" && action) {
      fetchInit.headers = { ...fetchInit.headers, "Content-Type": "application/json" };
      fetchInit.body = JSON.stringify({ action });
    }
    const r = await fetch(url, fetchInit);
    const elapsedMs = Date.now() - startedAt;
    const bodySnippet = (await r.text().catch(() => "")).slice(0, 500);
    if (!r.ok) {
      console.error("[cron-runner] non-2xx response", {
        cron,
        path,
        status: r.status,
        elapsedMs,
        body: bodySnippet,
      });
      return;
    }
    console.log("[cron-runner] ok", { cron, path, status: r.status, elapsedMs, body: bodySnippet });
  } catch (err) {
    console.error("[cron-runner] fetch failed", {
      cron,
      path,
      elapsedMs: Date.now() - startedAt,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
}

export default {
  // CF cron trigger entrypoint. Multiple cron expressions all land here; we
  // dispatch on event.cron. waitUntil keeps the request alive past the
  // scheduled handler return, so 5xx-grade slow Vercel responses don't get
  // truncated.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatch(event.cron, env));
  },

  // Healthcheck + manual trigger. GET / returns service status. To force-fire a
  // specific job for ops/debugging, hit GET /trigger/<cron>?key=<CRON_SECRET>.
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "dreyv-cron-runner",
        baseUrl: env.DREYV_BASE_URL ?? null,
        crons: Object.keys(ROUTES),
        secretConfigured: Boolean(env.CRON_SECRET),
      });
    }
    if (url.pathname.startsWith("/trigger/")) {
      const provided = url.searchParams.get("key");
      if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const cron = decodeURIComponent(url.pathname.slice("/trigger/".length));
      if (!ROUTES[cron]) {
        return Response.json({ ok: false, error: "unknown_cron", cron, known: Object.keys(ROUTES) }, { status: 400 });
      }
      ctx.waitUntil(dispatch(cron, env));
      return Response.json({ ok: true, dispatched: cron, route: ROUTES[cron] });
    }
    return new Response("not found", { status: 404 });
  },
};
