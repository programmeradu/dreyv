/**
 * DACS Phase 5.3 — Live handoff stream (SSE).
 *
 * GET /api/dacs/handoffs/stream?wallet=...&commandId=...
 *
 * Pushes newly-persisted AgentReport rows to the client as Server-Sent
 * Events. Uses a lightweight DB tail (poll every 1.5s, only emit rows whose
 * createdAt > lastSeen) so we don't need a pub/sub bus on the read side —
 * Inngest already publishes `agent.handoff.reported` to writers; this
 * endpoint surfaces what landed in `dacs_handoffs`.
 */
import { db } from "@/db";
import { dacsHandoffs } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const POLL_MS = 1500;
const HEARTBEAT_MS = 20_000;
const MAX_DURATION_MS = 5 * 60_000; // 5min cap; client reconnects via EventSource

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const commandId = url.searchParams.get("commandId");

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      let lastSeen = new Date();
      let closed = false;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let beatTimer: ReturnType<typeof setInterval> | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* connection dropped */
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (beatTimer) clearInterval(beatTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener("abort", close);

      send("hello", { ok: true, scopedTo: wallet, commandId, ts: Date.now() });

      if (!db) {
        send("error", { reason: "db_unavailable" });
        close();
        return;
      }
      const dbi = db;

      const poll = async () => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_DURATION_MS) {
          send("bye", { reason: "max_duration" });
          close();
          return;
        }
        try {
          const filters = [
            gt(dacsHandoffs.createdAt, lastSeen),
            wallet ? eq(dacsHandoffs.walletAddress, wallet) : undefined,
            commandId ? eq(dacsHandoffs.commandId, commandId) : undefined,
          ].filter(Boolean) as ReturnType<typeof eq>[];

          const rows = await dbi
            .select()
            .from(dacsHandoffs)
            .where(filters.length ? and(...filters) : undefined)
            .orderBy(desc(dacsHandoffs.createdAt))
            .limit(20);

          if (rows.length) {
            // rows are desc; emit oldest-first so the UI feed appends naturally.
            for (const row of [...rows].reverse()) {
              send("handoff", row);
              const created = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as unknown as string);
              if (created > lastSeen) lastSeen = created;
            }
          }
        } catch (e) {
          send("error", { reason: (e as Error).message });
        }
        if (!closed) pollTimer = setTimeout(poll, POLL_MS);
      };

      beatTimer = setInterval(() => send("ping", { ts: Date.now() }), HEARTBEAT_MS);
      poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
