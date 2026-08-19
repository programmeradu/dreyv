import { NextRequest, NextResponse } from "next/server";

import {
  INTEGRATION_REGISTRY,
  getIntegrationStatus,
  suggestIntegrations,
  detectUnknownProtocols,
} from "@/lib/studio/integration-registry";
import { categorizePrompt } from "@/lib/studio/prompt-categorizer";
import { db } from "@/db";
import { studioRuns } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { aiComplete, aiConfigured } from "@/lib/ai-gateway";


interface PlanIntegration {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "ready" | "needs_setup" | "researching";
  requiredEnv: string[];
  docsUrl?: string;
}

interface PlanFile {
  path: string;
  purpose: string;
}

interface PlanResponse {
  category: string;
  integrations: PlanIntegration[];
  files: PlanFile[];
  dataSources: string[];
  onChainCalls: string[];
  unknownProtocols: string[];
  needsUserInput: string[];
}

export async function POST(req: NextRequest) {

  let body: { prompt?: string; answers?: Record<string, string | string[]>; researchContext?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt = (body.prompt || "").trim();
  const answers = body.answers || {};
  const researchContext = (body.researchContext || "").slice(0, 12000);
  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }

  const category = await categorizePrompt(prompt);

  // Cold-start suggestions from heuristic
  const suggested = suggestIntegrations(prompt);

  // Self-learning: re-rank by past successful runs in same category
  let rankedIds = suggested.map((s) => s.id);
  if (db) {
    try {
      const past = await db
        .select({
          chosen: studioRuns.chosenIntegrations,
          outcome: studioRuns.analyzerOutcome,
        })
        .from(studioRuns)
        .where(and(eq(studioRuns.promptCategory, category), eq(studioRuns.shipped, true)))
        .orderBy(desc(studioRuns.createdAt))
        .limit(20);

      const score: Record<string, number> = {};
      for (const row of past) {
        const list = (row.chosen as Array<{ id: string }> | null) || [];
        for (const it of list) {
          score[it.id] = (score[it.id] || 0) + (row.outcome === "CLEAN" ? 2 : 1);
        }
      }
      rankedIds = [...new Set([...rankedIds, ...Object.keys(score)])].sort(
        (a, b) => (score[b] || 0) - (score[a] || 0)
      );
    } catch (err) {
      console.warn("[plan] self-learning rerank failed:", err);
    }
  }

  const integrations: PlanIntegration[] = rankedIds
    .map((id) => INTEGRATION_REGISTRY[id])
    .filter(Boolean)
    .map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      status: getIntegrationStatus(def),
      requiredEnv: def.requiredEnv,
      docsUrl: def.docsUrl,
    }));

  const unknownProtocols = detectUnknownProtocols(prompt);

  // Ask LLM to draft a file plan + on-chain calls + needs-input items.
  let files: PlanFile[] = [];
  let dataSources: string[] = [];
  let onChainCalls: string[] = [];
  let needsUserInput: string[] = [];

  if (aiConfigured()) {
    try {
      const sys = `You are the Dreyv Studio Planner. Output ONLY valid JSON matching this shape:
{
  "files": [{ "path": "App.tsx", "purpose": "..." }],
  "dataSources": ["Jupiter price API for SOL/USDC"],
  "onChainCalls": ["Marinade.deposit(amount)"],
  "needsUserInput": ["Helius API key", "User wallet connection"]
}
- Files: 1-4 files (App.tsx required). No mocks, no stubs.
- dataSources: real APIs/RPCs the app will call.
- onChainCalls: signed transactions or program reads.
- needsUserInput: anything the developer must provide before first run (keys, addresses, mints).`;
      const userMsg = `Prompt: ${prompt}
Clarifying answers: ${JSON.stringify(answers)}
Available integrations: ${integrations.map((i) => i.name).join(", ")}
Unknown protocols (will research): ${unknownProtocols.join(", ") || "none"}${
        researchContext
          ? `\n\n---\nLive web research already gathered (use to ground real API/SDK names, endpoints, params):\n${researchContext}`
          : ""
      }`;

      const out = await aiComplete({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        timeoutMs: 30_000,
      });
      if (out) {
        try {
          const parsed = typeof out === "string" ? JSON.parse(out) : out;
          files = Array.isArray(parsed.files) ? parsed.files.slice(0, 6) : [];
          dataSources = Array.isArray(parsed.dataSources) ? parsed.dataSources.slice(0, 8) : [];
          onChainCalls = Array.isArray(parsed.onChainCalls) ? parsed.onChainCalls.slice(0, 8) : [];
          needsUserInput = Array.isArray(parsed.needsUserInput) ? parsed.needsUserInput.slice(0, 8) : [];
        } catch (err) {
          console.warn("[plan] parse failed:", err);
        }
      }
    } catch (err) {
      console.warn("[plan] LLM call failed:", err);
    }
  }

  // Static fallback if LLM unavailable
  if (files.length === 0) {
    files = [
      { path: "App.tsx", purpose: "Main UI + data fetching with useFetch hook" },
      { path: "utils.ts", purpose: "Formatters and helpers" },
    ];
  }

  // Mark unknown protocols as researching
  for (const p of unknownProtocols) {
    integrations.push({
      id: `research:${p.toLowerCase()}`,
      name: p,
      description: "Unknown protocol — researching SDK shape.",
      category: "other",
      status: "researching",
      requiredEnv: [],
    });
  }

  const response: PlanResponse = {
    category,
    integrations,
    files,
    dataSources,
    onChainCalls,
    unknownProtocols,
    needsUserInput,
  };

  return NextResponse.json(response);
}
