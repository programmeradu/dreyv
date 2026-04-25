/**
 * DACS Phase 1 — Server-Sent Events proxy for the agent command bus.
 *
 * The browser opens `GET /api/dacs/stream?commandId=cmd_xxx` after submitting
 * a command and receives streaming `intent`, `plan`, `decision`, `done` frames
 * as the `commandRouter` Inngest function progresses. Implemented as a DB poll
 * over `command_diff_log` so it works across serverless cold starts (no
 * shared-memory pub/sub assumption).
 *
 * Runtime: Node (drizzle requires it). Dynamic so Next never caches.
 * Auto-closes after 60s or once `decisionKind` is recorded — whichever first.
 */

import { NextRequest } from "next/server";
import { db } from "@/db";
import { commandDiffLog } from "@/db/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DURATION_MS = 60_000;
const POLL_INTERVAL_MS = 750;

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest) {
  const commandId = req.nextUrl.searchParams.get("commandId");
  if (!commandId) {
    return new Response("missing commandId", { status: 400 });
  }
  if (!db) {
    return new Response("db not configured", { status: 503 });
  }
  const dbx = db;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(frame(event, data)));
        } catch {
          // controller already closed
        }
      };

      send("hello", { commandId, ts: Date.now() });

      const startedAt = Date.now();
      let sentIntent = false;
      let sentPlan = false;
      let sentDecision = false;

      // Heartbeat keeps proxies / load balancers from killing the stream.
      const heartbeat = setInterval(() => send("ping", { ts: Date.now() }), 15_000);

      try {
        while (Date.now() - startedAt < MAX_DURATION_MS) {
          const rows = await dbx
            .select()
            .from(commandDiffLog)
            .where(sql`${commandDiffLog.commandId} = ${commandId}`)
            .limit(1);
          const row = rows[0];

          if (row) {
            if (!sentIntent && row.dacsIntent) {
              send("intent", row.dacsIntent);
              sentIntent = true;
            }
            if (!sentPlan && row.dacsPlan) {
              send("plan", row.dacsPlan);
              sentPlan = true;
            }
            if (!sentDecision && row.dacsDecisionKind) {
              send("decision", {
                kind: row.dacsDecisionKind,
                reason: row.dacsDecisionReason,
                latencyMs: row.dacsLatencyMs,
              });
              sentDecision = true;
              send("done", { parity: row.parity ?? null });
              break;
            }
          }

          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }

        if (!sentDecision) {
          send("timeout", { afterMs: Date.now() - startedAt });
        }
      } catch (e) {
        send("error", { message: (e as Error).message });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* noop */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
