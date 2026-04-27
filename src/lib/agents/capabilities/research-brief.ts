/**
 * Phase 7B — Protocol research brief capability.
 *
 * What it does:
 *   1. Researches a named protocol via Firecrawl + Perplexity + Lovable AI
 *      fallback (re-uses the existing `/api/studio/research` infrastructure
 *      via direct module call to keep it side-effect free).
 *   2. Asks Lovable AI to extract a structured executive summary, 3-5 key
 *      insights, and 2-4 personalized treasury suggestions tailored to the
 *      connected wallet's holdings (so Dreyv *relates* to the user's
 *      treasury — not a generic essay).
 *   3. Renders a clean PDF Research Brief and uploads it as an artifact.
 *   4. Returns artifacts[] + suggestions[] + insights[] so the CommandBar
 *      auto-pins a `research-brief` block to the Living Canvas.
 *
 * No fakes. If Lovable AI is unavailable, the suggestions list is empty
 * (and the LLM is instructed by ARTIFACT_HONESTY_RULES to surface that
 * truthfully rather than invent strategies).
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { knowledgeBase } from "@/lib/knowledge";
import { knowledgeMemory } from "@/lib/knowledge-memory";
import { renderResearchBriefPdf } from "../artifacts/research-brief-pdf";
import { uploadArtifact } from "../artifacts/storage";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface BriefStructured {
  summary: string;
  insights: string[];
  suggestions: Array<{ title: string; detail: string; cta: string }>;
}

async function synthesizeBrief(args: {
  protocol: string;
  rawMarkdown: string;
  walletSummary: string;
}): Promise<BriefStructured> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) {
    return {
      summary: args.rawMarkdown.slice(0, 600) || `Research collected for ${args.protocol}.`,
      insights: [],
      suggestions: [],
    };
  }

  const sys = `You are Dreyv, a Solana treasury copilot.
You just researched the protocol "${args.protocol}". Given the raw research
notes and the user's current treasury snapshot, return STRUCTURED JSON via
the provided tool. Be specific. Tie suggestions to the user's actual holdings
when possible. NEVER invent figures the user did not provide. If the snapshot
is empty, suggestions may reference what the protocol enables generically but
must say "once your wallet is connected" rather than hallucinating amounts.`;

  const user = `RESEARCH NOTES:\n${args.rawMarkdown.slice(0, 8000)}\n\nUSER TREASURY SNAPSHOT:\n${args.walletSummary}`;

  try {
    const res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_research_brief",
              description: "Return the structured research brief.",
              parameters: {
                type: "object",
                properties: {
                  summary: { type: "string", description: "2-4 sentence executive summary." },
                  insights: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-5 concrete insights about the protocol.",
                  },
                  suggestions: {
                    type: "array",
                    description:
                      "2-4 ways Dreyv could help this specific user's treasury using the protocol. Each tied to user holdings if known.",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        detail: { type: "string" },
                        cta: {
                          type: "string",
                          description:
                            "A natural-language command the user could run in the CommandBar to act on it.",
                        },
                      },
                      required: ["title", "detail", "cta"],
                    },
                  },
                },
                required: ["summary", "insights", "suggestions"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_research_brief" } },
      }),
    });
    if (!res.ok) {
      console.warn("[research_brief] LLM synthesis failed:", res.status);
      return { summary: args.rawMarkdown.slice(0, 600), insights: [], suggestions: [] };
    }
    const data = await res.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    const argsStr = call?.function?.arguments;
    if (typeof argsStr === "string") {
      const parsed = JSON.parse(argsStr) as BriefStructured;
      return {
        summary: parsed.summary || args.rawMarkdown.slice(0, 600),
        insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 5) : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 4) : [],
      };
    }
  } catch (err) {
    console.warn("[research_brief] synth error:", err);
  }
  return { summary: args.rawMarkdown.slice(0, 600), insights: [], suggestions: [] };
}

function summarizeWallet(ctx: {
  walletAddress: string | null;
  walletState: { balances?: Array<Record<string, unknown>> } | null;
  vaultState: { tokens?: Array<Record<string, unknown>> } | null;
}): string {
  if (!ctx.walletAddress) return "(no wallet connected — give generic, opt-in framings)";
  const lines: string[] = [`wallet=${ctx.walletAddress}`];
  const bals = ctx.walletState?.balances ?? [];
  if (bals.length) {
    lines.push(`wallet balances (${bals.length}):`);
    for (const b of bals.slice(0, 8)) {
      const sym = (b.symbol as string) ?? (b.mint as string) ?? "?";
      const amt = (b.amount as number) ?? (b.uiAmount as number) ?? 0;
      lines.push(`  - ${sym}: ${amt}`);
    }
  }
  const toks = ctx.vaultState?.tokens ?? [];
  if (toks.length) {
    lines.push(`vault tokens (${toks.length}):`);
    for (const t of toks.slice(0, 8)) {
      const sym = (t.symbol as string) ?? (t.mint as string) ?? "?";
      const amt = (t.amount as number) ?? (t.uiAmount as number) ?? 0;
      lines.push(`  - ${sym}: ${amt}`);
    }
  }
  if (lines.length === 1) lines.push("(no balances loaded yet)");
  return lines.join("\n");
}

const protocol_research_brief = defineCapability({
  id: "protocol_research_brief",
  domain: "intel",
  description:
    "Research a Solana protocol and produce a downloadable PDF brief PLUS personalized strategy suggestions tied to the user's treasury. Use when the user asks Dreyv to research a protocol or wants to know what they could do with one.",
  inputSchema: z.object({
    protocol: z.string().describe("Protocol name, e.g. 'Marinade', 'Kamino', 'Jupiter'."),
    intent: z
      .string()
      .optional()
      .describe("Optional context — what the user wants to do with this protocol."),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async (input, ctx) => {
    const protocol = input.protocol.trim();
    const intent = input.intent?.trim() ?? "";

    // 1. Gather research (knowledgeBase.study uses Tavily + scrapers + persists to KB).
    let rawMarkdown = "";
    const sources: Array<{ url: string; source: string }> = [];
    try {
      const study = await knowledgeBase.study(`${protocol} solana sdk how it works`);
      rawMarkdown = study.rawContent || study.summary || "";
      for (const s of (study.sources ?? []).slice(0, 6)) {
        sources.push({ url: s.url, source: "tavily" });
      }
    } catch (err) {
      console.warn("[protocol_research_brief] knowledgeBase.study failed:", err);
    }

    if (!rawMarkdown) {
      return {
        success: false,
        operation: "protocol_research_brief",
        status: "no_research" as const,
        protocol,
        artifacts: [],
        suggestions: [],
        insights: [],
        sources: [],
        error: "RESEARCH_UNAVAILABLE",
        message: `Couldn't gather research for "${protocol}" — research providers (Tavily / Firecrawl / Perplexity) are not configured or returned nothing. Add the API keys or try again later.`,
      };
    }

    // 2. Personalized synthesis.
    const walletSummary = summarizeWallet(ctx);
    const brief = await synthesizeBrief({
      protocol: intent ? `${protocol} (user intent: ${intent})` : protocol,
      rawMarkdown,
      walletSummary,
    });

    // 3. Render and upload PDF.
    const generatedAt = new Date().toISOString();
    const pdf = await renderResearchBriefPdf({
      protocol,
      generatedAt,
      walletAddress: ctx.walletAddress,
      summary: brief.summary,
      insights: brief.insights,
      suggestions: brief.suggestions,
      sources,
      rawMarkdown,
    });

    const ownerKey = ctx.walletAddress || "anon";
    const slug = protocol.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);
    const artifact = await uploadArtifact({
      body: pdf,
      filename: `dreyv-research-${slug}-${generatedAt.slice(0, 10)}.pdf`,
      mime: "application/pdf",
      kind: "pdf",
      ownerKey,
      folder: `research/${slug}`,
      capabilityId: "protocol_research_brief",
      meta: { protocol, intent, sources: sources.length },
    });

    // 4. Persist the brief to long-term knowledge memory (best-effort).
    try {
      await knowledgeMemory.store({
        source: "research_brief",
        title: `Research brief: ${protocol}`,
        summary: brief.summary,
        content: [
          `# ${protocol}`,
          "",
          brief.summary,
          "",
          ...brief.insights.map((i) => `- ${i}`),
        ].join("\n"),
        tags: ["research", "brief", slug],
      });
    } catch {
      /* non-fatal */
    }

    return {
      success: true,
      operation: "protocol_research_brief",
      status: "completed" as const,
      protocol,
      summary: brief.summary,
      insights: brief.insights,
      suggestions: brief.suggestions,
      sources,
      artifacts: [artifact],
      message: `Research brief on ${protocol} ready — ${brief.insights.length} insight${brief.insights.length === 1 ? "" : "s"}, ${brief.suggestions.length} suggestion${brief.suggestions.length === 1 ? "" : "s"} tailored to your treasury.`,
    };
  },
});

export const researchBriefCapabilities: AnyCapability[] = [
  protocol_research_brief as AnyCapability,
];
