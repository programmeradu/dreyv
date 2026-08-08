/**
 * SSE runner: streams per-(scenario × provider) results back to the client
 * as they finish. Each provider call for a scenario runs in parallel; the
 * three providers race and we emit events the moment each one returns.
 *
 * Auth: requires the `dreyv-benchmark-allow` cookie set by /api/benchmark/unlock.
 *
 * Concurrency: scenarios processed sequentially (1 at a time) to keep the
 * upstream rate limits friendly and to make per-scenario latency comparable.
 */

import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SCENARIOS } from "@/lib/benchmark/scenarios";
import { PROVIDERS, runProvider } from "@/lib/benchmark/providers";
import { runJudge, scoreDeterministic } from "@/lib/benchmark/judge";
import { BENCHMARK_TOOLS } from "@/lib/benchmark/tools";
import { buildLiveVaultSnapshot, renderVaultContext } from "@/lib/benchmark/vault-live";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const COOKIE = "dreyv-benchmark-allow";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be configured");
  return new TextEncoder().encode(secret);
}

async function authed(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { issuer: "keystone-treasury-os" });
    return payload.purpose === "benchmark-access";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!(await authed(req))) {
    return new Response("unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(SCENARIOS.length, Number(url.searchParams.get("limit") || SCENARIOS.length)));
  const skipJudge = url.searchParams.get("judge") === "0";
  const list = SCENARIOS.slice(0, limit);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("start", { total: list.length, providers: PROVIDERS, startedAt: Date.now() });

      // Fetch the live vault snapshot ONCE and feed it to every provider.
      let snapshot;
      try {
        snapshot = await buildLiveVaultSnapshot();
      } catch (e) {
        snapshot = { address: "?", label: "fetch failed", asOf: "", totalUsd: 0, solBalance: 0, holdings: [], fungibleCount: 0, nftCount: 0, nftSample: [], source: "fallback" as const, warning: (e as Error).message };
      }
      const vaultContext = renderVaultContext(snapshot);
      send("vault", { snapshot, contextChars: vaultContext.length });

      for (let i = 0; i < list.length; i++) {
        const scenario = list[i];
        send("scenario_start", { index: i, scenario });

        const tools = scenario.category === "tool_use" ? BENCHMARK_TOOLS : undefined;
        const results = await Promise.all(
          PROVIDERS.map(async (p) => {
            const r = await runProvider(p, scenario.prompt, vaultContext, tools);
            const det = scoreDeterministic(scenario, r);
            const judge = skipJudge ? null : await runJudge(scenario, r);
            return { provider: p, result: r, deterministic: det, judge };
          }),
        );

        send("scenario_done", { index: i, scenario, results });
      }

      send("end", { finishedAt: Date.now() });
      controller.close();
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
