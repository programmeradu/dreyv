/**
 * Phase 7 — SSE realtime push channel.
 *
 * The CommandBar subscribes to this stream and surfaces autopilot/alert/
 * proposal events as toasts AND injects a system message on the next user
 * turn so the agent can reason over them.
 *
 * This is a pull-shaped poll-over-SSE: we tail recent rows from
 * agent_proposals, agent_autopilot_runs, and agent_tool_metrics for the
 * authenticated user. It avoids needing Postgres LISTEN/NOTIFY in the
 * serverless runtime and degrades gracefully on Vercel.
 */
import { NextRequest } from "next/server";
import { db } from "@/db";
import { agentProposals, agentAutopilotRuns, agentToolMetrics } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 4_000;
const MAX_DURATION_MS = 50_000; // serverless safe

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!db) return new Response("DB unavailable", { status: 503 });

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let cursor = new Date();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      send("hello", { ok: true, ts: Date.now() });

      while (Date.now() - startedAt < MAX_DURATION_MS) {
        try {
          const [props, runs, errs] = await Promise.all([
            db!.select().from(agentProposals)
              .where(and(eq(agentProposals.userId, user.id), gt(agentProposals.createdAt, cursor)))
              .orderBy(desc(agentProposals.createdAt)).limit(10),
            db!.select().from(agentAutopilotRuns)
              .where(and(eq(agentAutopilotRuns.userId, user.id), gt(agentAutopilotRuns.createdAt, cursor)))
              .orderBy(desc(agentAutopilotRuns.createdAt)).limit(10),
            db!.select().from(agentToolMetrics)
              .where(and(eq(agentToolMetrics.userId, user.id), gt(agentToolMetrics.createdAt, cursor), eq(agentToolMetrics.outcome, "error")))
              .orderBy(desc(agentToolMetrics.createdAt)).limit(5),
          ]);

          for (const p of props) {
            send("agent_push", {
              kind: "proposal",
              id: p.id, title: p.title, status: p.status,
              policyReason: (p as any).policyReason ?? null,
              createdAt: p.createdAt,
            });
          }
          for (const r of runs) {
            send("agent_push", {
              kind: "autopilot_run",
              id: r.id, jobId: r.jobId, status: r.status,
              vaultId: r.vaultId, outcome: r.outcome, createdAt: r.createdAt,
            });
          }
          for (const e of errs) {
            send("agent_push", {
              kind: "tool_error",
              capabilityId: e.capabilityId, errorCode: e.errorCode,
              latencyMs: e.latencyMs, createdAt: e.createdAt,
            });
          }

          if (props.length || runs.length || errs.length) {
            cursor = new Date();
          }
          send("ping", { ts: Date.now() });
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        } catch (err) {
          send("error", { message: (err as Error).message });
          break;
        }
      }
      controller.close();
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
