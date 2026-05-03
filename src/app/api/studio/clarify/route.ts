import { NextRequest, NextResponse } from "next/server";

import { knowledgeBase } from "@/lib/knowledge";
import { markdown as cfMarkdown } from "@/lib/cloudflare/cf-browser";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface ClarifyQuestion {
  id: string;
  text: string;
  options: string[];
  multi: boolean;
}

const SYSTEM_PROMPT = `You are the Dreyv Studio Architect.
Given a user's app-build prompt (and optional research context from the live web), return 2-4 TARGETED clarifying questions that lock the spec for THIS specific app.

Rules:
- Questions MUST be specific to the prompt. Do NOT default to wallet/network/read-only unless the app actually involves on-chain reads or signed transactions.
  - Example: "build email sender for price alerts with Resend" → ask about asset to track, threshold direction, recipient, frequency. NOT "which wallet".
  - Example: "swap UI with Jupiter" → ask about default token pair, slippage default, wallet support.
- Prefer chip/radio answers over free-text. Each question has 2-5 short option strings.
- Use the research context (when provided) to ground options in real protocol/SDK names instead of guesses.
- Skip anything already obvious from the prompt.

Respond with ONLY a JSON object — no prose, no markdown:
{
  "questions": [
    { "id": "snake_case_id", "text": "...", "options": ["..."], "multi": false }
  ]
}`;

const URL_RE = /https?:\/\/[^\s)]+/gi;

async function gatherResearch(prompt: string): Promise<string> {
  const tasks: Promise<string>[] = [];

  // 1. Tavily/Jina/Firecrawl multi-vector study
  tasks.push(
    knowledgeBase
      .study(prompt)
      .then((r) =>
        r.sources.length
          ? `### Web research (${r.sources.length} sources)\n${r.summary}\n\nTop sources:\n${r.sources
              .map((s) => `- ${s.title} — ${s.url}`)
              .join("\n")}\n\n${r.rawContent.slice(0, 4000)}`
          : ""
      )
      .catch(() => "")
  );

  // 2. CF /markdown for any URL pasted in the prompt
  const urls = Array.from(new Set((prompt.match(URL_RE) ?? []) as string[])).slice(0, 2);
  for (const url of urls) {
    tasks.push(
      cfMarkdown({ url })
        .then((md) => (md ? `### CF /markdown — ${url}\n${md.slice(0, 3500)}` : ""))
        .catch(() => "")
    );
  }

  const results = await Promise.allSettled(tasks);
  return results
    .map((r) => (r.status === "fulfilled" ? r.value : ""))
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 12000);
}

export async function POST(req: NextRequest) {
  const limit = await checkRouteLimit(req, "ai_architect_runs");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Rate limited", retryAfter: Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000) },
      { status: 429 }
    );
  }

  let body: { prompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt = (body.prompt || "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ questions: fallbackQuestions(prompt), researchContext: "" });
  }

  // Run research first so clarify questions are grounded in real protocol shape.
  const researchContext = await gatherResearch(prompt);

  try {
    const userContent = researchContext
      ? `User prompt:\n${prompt.slice(0, 1000)}\n\n---\nResearch context (use to ground your questions in real APIs/SDKs):\n${researchContext}`
      : `User prompt:\n${prompt.slice(0, 1000)}`;

    const res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        max_tokens: 700,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      console.warn("[clarify] Lovable AI failed:", res.status);
      return NextResponse.json({ questions: fallbackQuestions(prompt), researchContext });
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    let parsed: { questions?: ClarifyQuestion[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ questions: fallbackQuestions(prompt), researchContext });
    }

    const questions = Array.isArray(parsed.questions) ? parsed.questions.slice(0, 4) : [];
    if (questions.length === 0) {
      return NextResponse.json({ questions: fallbackQuestions(prompt), researchContext });
    }

    return NextResponse.json({ questions, researchContext });
  } catch (err) {
    console.error("[clarify] error:", err);
    return NextResponse.json({ questions: fallbackQuestions(prompt), researchContext });
  }
}

function fallbackQuestions(prompt: string): ClarifyQuestion[] {
  const lower = prompt.toLowerCase();
  const onchain = /\b(swap|wallet|stake|vault|nft|mint|tx|transaction|sign|on[- ]chain|spl|sol|solana|jupiter|marinade)\b/.test(
    lower
  );
  if (onchain) {
    return [
      { id: "network", text: "Which network?", options: ["Mainnet", "Devnet"], multi: false },
      {
        id: "wallets",
        text: "Which wallets to support?",
        options: ["Phantom", "Solflare", "Backpack", "All"],
        multi: true,
      },
      {
        id: "mode",
        text: "Read-only or transactional?",
        options: ["Read-only", "Transactional"],
        multi: false,
      },
    ];
  }
  return [
    {
      id: "scope",
      text: "What's the primary goal of this app?",
      options: ["Notify me", "Show me data", "Take an action", "Other"],
      multi: false,
    },
    {
      id: "frequency",
      text: "How often should it run?",
      options: ["Realtime", "Every few minutes", "On-demand"],
      multi: false,
    },
  ];
}
