import { NextRequest, NextResponse } from "next/server";
import { checkRouteLimit } from "@/lib/rate-limit-middleware";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface ClarifyQuestion {
  id: string;
  text: string;
  options: string[];
  multi: boolean;
}

const SYSTEM_PROMPT = `You are the Dreyv Studio Architect.
Given a user's app-build prompt, return 2-4 targeted clarifying questions to lock the spec.

Rules:
- Prefer chip/radio answers over free-text.
- Always ask about: target network (mainnet/devnet), wallets, read-only vs transactional.
- Add 1-2 prompt-specific questions (target protocol, token mint, refresh interval, etc.).
- Each question must have 2-5 short option strings.

Respond with ONLY a JSON object — no prose, no markdown:
{
  "questions": [
    { "id": "network", "text": "Which network?", "options": ["Mainnet", "Devnet"], "multi": false }
  ]
}`;

export async function POST(req: NextRequest) {
  const limit = await checkRouteLimit(req, "ai_architect_runs");
  if (!limit.success) {
    return NextResponse.json(
      { error: "Rate limited", retryAfter: limit.retryAfter },
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
    // Fallback static questions so the flow still works.
    return NextResponse.json({ questions: fallbackQuestions(prompt) });
  }

  try {
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
          { role: "user", content: prompt.slice(0, 1000) },
        ],
        response_format: { type: "json_object" },
        max_tokens: 600,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      console.warn("[clarify] Lovable AI failed:", res.status);
      return NextResponse.json({ questions: fallbackQuestions(prompt) });
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    let parsed: { questions?: ClarifyQuestion[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ questions: fallbackQuestions(prompt) });
    }

    const questions = Array.isArray(parsed.questions) ? parsed.questions.slice(0, 4) : [];
    if (questions.length === 0) {
      return NextResponse.json({ questions: fallbackQuestions(prompt) });
    }

    return NextResponse.json({ questions });
  } catch (err) {
    console.error("[clarify] error:", err);
    return NextResponse.json({ questions: fallbackQuestions(prompt) });
  }
}

function fallbackQuestions(_prompt: string): ClarifyQuestion[] {
  return [
    { id: "network", text: "Which network?", options: ["Mainnet", "Devnet"], multi: false },
    { id: "wallets", text: "Which wallets to support?", options: ["Phantom", "Solflare", "Backpack", "All"], multi: true },
    { id: "mode", text: "Read-only or transactional?", options: ["Read-only (view balances/data)", "Transactional (sign + send)"], multi: false },
    { id: "refresh", text: "How fresh should data be?", options: ["Realtime (<10s)", "Frequent (~30s)", "On-demand"], multi: false },
  ];
}
