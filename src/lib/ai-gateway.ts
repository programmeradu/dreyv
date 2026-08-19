/**
 * Unified AI gateway (server-only).
 *
 * Single entry point for every text/JSON model call in the app. No Lovable
 * Cloud / Supabase edge proxy involved — the chain talks directly to the
 * providers whose keys live in the deployment environment.
 *
 * Chain (first success wins, never throws):
 *   1. Google Gemini      — GEMINI_API_KEY | GOOGLE_AI_API_KEY | GOOGLE_GENAI_API_KEY
 *   2. Groq               — GROQ_API_KEY
 *   3. OpenAI             — OPENAI_API_KEY
 *
 * Returns parsed JSON when `tools` or `response_format` is supplied, plain
 * assistant text otherwise, and `null` when every provider is unavailable.
 */

export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: any };

export interface AiCallOptions {
  model?: string;
  messages: ChatMessage[];
  tools?: any;
  tool_choice?: any;
  response_format?: any;
  temperature?: number;
  timeoutMs?: number;
}

const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const DEFAULT_MODEL = "google/gemini-2.5-flash";

function geminiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_GENAI_API_KEY?.trim()
  );
}

/** Resolve the provider-specific model id from a generic/prefixed name. */
function resolveModel(model: string | undefined, provider: "gemini" | "groq" | "openai"): string {
  const m = model || DEFAULT_MODEL;
  if (provider === "gemini") return m.replace(/^google\//, "");
  if (provider === "groq") {
    return /gemini|google\//i.test(m) || /^gpt/i.test(m) ? "llama-3.3-70b-versatile" : m;
  }
  return /gemini|google\/|llama/i.test(m) ? "gpt-4o-mini" : m;
}

async function callOpenAiCompatible(
  label: string,
  url: string,
  key: string,
  model: string,
  opts: AiCallOptions,
): Promise<any | null> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        stream: false,
        ...(opts.tools ? { tools: opts.tools } : {}),
        ...(opts.tool_choice ? { tool_choice: opts.tool_choice } : {}),
        ...(opts.response_format ? { response_format: opts.response_format } : {}),
        ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    });
    if (!r.ok) {
      console.warn(`[ai-gateway:${label}] non-ok`, r.status, (await r.text().catch(() => "")).slice(0, 200));
      return null;
    }
    return extractOpenAIStyle(await r.json(), opts);
  } catch (e) {
    console.warn(`[ai-gateway:${label}] error`, (e as Error)?.message);
    return null;
  }
}

/** Run the provider chain. Never throws; returns null when nothing worked. */
export async function aiComplete(opts: AiCallOptions): Promise<any | null> {
  const gem = geminiKey();
  if (gem) {
    const out = await callOpenAiCompatible("gemini", GEMINI_OPENAI_URL, gem, resolveModel(opts.model, "gemini"), opts);
    if (out !== null) return out;
  }

  const groq = process.env.GROQ_API_KEY?.trim();
  if (groq) {
    const out = await callOpenAiCompatible("groq", GROQ_URL, groq, resolveModel(opts.model, "groq"), opts);
    if (out !== null) return out;
  }

  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) {
    const out = await callOpenAiCompatible("openai", OPENAI_URL, openai, resolveModel(opts.model, "openai"), opts);
    if (out !== null) return out;
  }

  return null;
}

function extractOpenAIStyle(j: any, opts: AiCallOptions): any | null {
  if (opts.tools) {
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    try {
      return JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (opts.response_format) {
    const txt = j?.choices?.[0]?.message?.content;
    if (!txt) return null;
    try {
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }
  return j?.choices?.[0]?.message?.content ?? null;
}

/** Convenience: structured-JSON call with an optional function tool schema. */
export async function aiJson(system: string, user: string, schema?: any): Promise<any | null> {
  return aiComplete({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(schema
      ? {
          tools: [{ type: "function", function: schema }],
          tool_choice: { type: "function", function: { name: schema.name } },
        }
      : { response_format: { type: "json_object" } }),
  });
}

/** True when at least one provider key is configured. */
export function aiConfigured(): boolean {
  return Boolean(geminiKey() || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}

/**
 * Streaming variant: returns an SSE `Response` (OpenAI-compatible chunk format)
 * ready to hand back to the browser, or `null` when no provider is configured
 * or every provider failed.
 */
export async function aiStreamResponse(opts: AiCallOptions): Promise<Response | null> {
  const chain: Array<{ label: string; url: string; key: string; provider: "gemini" | "groq" | "openai" }> = [];
  const gem = geminiKey();
  if (gem) chain.push({ label: "gemini", url: GEMINI_OPENAI_URL, key: gem, provider: "gemini" });
  const groq = process.env.GROQ_API_KEY?.trim();
  if (groq) chain.push({ label: "groq", url: GROQ_URL, key: groq, provider: "groq" });
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) chain.push({ label: "openai", url: OPENAI_URL, key: openai, provider: "openai" });

  for (const entry of chain) {
    try {
      const upstream = await fetch(entry.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${entry.key}` },
        body: JSON.stringify({
          model: resolveModel(opts.model, entry.provider),
          messages: opts.messages,
          stream: true,
          ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
        }),
      });
      if (!upstream.ok || !upstream.body) {
        console.warn(`[ai-gateway:${entry.label}:stream] non-ok`, upstream.status);
        continue;
      }
      return new Response(upstream.body, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
      });
    } catch (e) {
      console.warn(`[ai-gateway:${entry.label}:stream] error`, (e as Error)?.message);
    }
  }
  return null;
}
