export const runtime = "edge";
/**
 * Phase 5 — Server-sent events stream for the API-key owner.
 *
 *   GET /api/v1/stream?events=watcher.delta,monitor.tripped
 *   Authorization: Bearer dk_live_…
 *
 * For clients that prefer pull-streaming over registering a webhook. We
 * tail the `webhook_deliveries` table (status=ok) plus the
 * `notifications` table for the owner and stream new rows as `event:`
 * frames. Polling cadence: 1.5s. Keep-alive comment every 25s so
 * intermediaries don't drop the connection.
 */

import { NextRequest } from "next/server";
import { db } from "@/db";
import { webhookDeliveries, notifications } from "@/db/schema";
import { and, eq, gt, inArray } from "drizzle-orm";
import { extractBearer, resolvePublicKey } from "@/lib/api-keys/public-keys";
import { ALL_WEBHOOK_EVENTS } from "@/lib/webhooks/dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 1500;
const KEEPALIVE_MS = 25_000;
const MAX_STREAM_MS = 290_000; // hard ceiling under platform timeout

export async function GET(req: NextRequest) {
  const key = await resolvePublicKey(extractBearer(req));
  if (!key) {
    return new Response(
      JSON.stringify({ error: "unauthorized", message: "Pass `Authorization: Bearer dk_live_…`" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  if (!db) {
    return new Response(JSON.stringify({ error: "db_unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const rawEvents = (url.searchParams.get("events") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = new Set<string>([...ALL_WEBHOOK_EVENTS]);
  const filter = rawEvents.includes("*")
    ? null
    : rawEvents.filter((e) => allowed.has(e));
  if (filter && filter.length === 0) {
    return new Response(
      JSON.stringify({ error: "invalid_events", allowed: [...allowed] }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const startedAt = Date.now();
  let cursorDeliveries = new Date();
  let cursorNotifications = new Date();
  const userId = key.userId;
  const dbi = db;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown, id?: string) => {
        const lines = [
          id ? `id: ${id}` : "",
          `event: ${event}`,
          `data: ${JSON.stringify(data)}`,
          "",
          "",
        ].filter(Boolean);
        controller.enqueue(enc.encode(lines.join("\n")));
      };

      send("ready", {
        userId,
        keyId: key.id,
        filter: filter ?? "*",
        pollIntervalMs: POLL_MS,
        maxStreamMs: MAX_STREAM_MS,
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          /* connection closed */
        }
      }, KEEPALIVE_MS);

      const tick = async () => {
        try {
          // 1. New webhook deliveries (ok only — failures stay in /webhooks/deliveries).
          const delConds = [
            eq(webhookDeliveries.userId, userId),
            eq(webhookDeliveries.status, "ok"),
            gt(webhookDeliveries.createdAt, cursorDeliveries),
          ];
          if (filter) delConds.push(inArray(webhookDeliveries.event, filter));
          const dels = await dbi
            .select()
            .from(webhookDeliveries)
            .where(and(...delConds))
            .limit(50);
          for (const d of dels) {
            send(d.event, { ...(typeof d.payload === "object" ? d.payload : { payload: d.payload }), _deliveryId: d.id }, d.id);
            if (d.createdAt > cursorDeliveries) cursorDeliveries = d.createdAt;
          }

          // 2. Notifications surfaced as `notification.created`.
          if (!filter || filter.includes("notification.created")) {
            const notifs = await dbi
              .select()
              .from(notifications)
              .where(and(eq(notifications.userId, userId), gt(notifications.createdAt, cursorNotifications)))
              .limit(50);
            for (const n of notifs) {
              send(
                "notification.created",
                {
                  id: n.id,
                  type: n.type,
                  title: n.title,
                  message: n.message,
                  severity: n.severity,
                  actionUrl: n.actionUrl,
                  metadata: n.metadata,
                  createdAt: n.createdAt,
                },
                `notif-${n.id}`,
              );
              if (n.createdAt > cursorNotifications) cursorNotifications = n.createdAt;
            }
          }
        } catch (err) {
          send("error", { message: err instanceof Error ? err.message : String(err) });
        }
      };

      const poll = setInterval(() => {
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          send("close", { reason: "max_stream_duration", reconnect: true });
          clearInterval(poll);
          clearInterval(keepalive);
          try { controller.close(); } catch { /* already closed */ }
          return;
        }
        void tick();
      }, POLL_MS);

      req.signal.addEventListener("abort", () => {
        clearInterval(poll);
        clearInterval(keepalive);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
