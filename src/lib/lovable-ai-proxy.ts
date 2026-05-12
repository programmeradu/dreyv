/**
 * Lovable AI proxy client (server-only).
 *
 * Per project policy, LOVABLE_API_KEY never lives on Vercel. All Lovable AI
 * calls go through the `lovable-ai-proxy` Supabase edge function which holds
 * the key in the Lovable Cloud workspace.
 *
 * Required Vercel envs:
 *   LOVABLE_AI_PROXY_URL   — full URL to the edge function
 *                            e.g. https://<ref>.functions.supabase.co/lovable-ai-proxy
 *   LOVABLE_SUPABASE_ANON_KEY — anon key for the workspace (used as Authorization)
 */

type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: any };

interface CallOptions {
  model?: string;
  messages: ChatMessage[];
  tools?: any;
  tool_choice?: any;
  response_format?: any;
  temperature?: number;
  timeoutMs?: number;
}

function getProxyUrl(): string | null {
  const direct = process.env.LOVABLE_AI_PROXY_URL?.trim();
  if (direct) return direct;
  const sbUrl = process.env.LOVABLE_SUPABASE_URL?.trim();
  if (sbUrl) return `${sbUrl.replace(/\/$/, "")}/functions/v1/lovable-ai-proxy`;
  return null;
}

/**
 * Call the Lovable AI gateway via the workspace edge proxy and return either
 * a parsed JSON object (when `tools` or `response_format` is provided) or the
 * raw assistant text. Returns null on any failure so callers can fall back
 * gracefully — never throws.
 */
export async function lovableAi(opts: CallOptions): Promise<any | null> {
  const url = getProxyUrl();
  const auth = process.env.LOVABLE_SUPABASE_ANON_KEY?.trim();
  if (!url || !auth) {
    return null;
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth}`,
        apikey: auth,
      },
      body: JSON.stringify({
        model: opts.model || "google/gemini-2.5-flash",
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
      const txt = await r.text().catch(() => "");
      console.warn("[lovable-ai-proxy] non-ok", r.status, txt.slice(0, 200));
      return null;
    }
    const j = await r.json();
    if (opts.tools) {
      const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) return null;
      try { return JSON.parse(args); } catch { return null; }
    }
    if (opts.response_format) {
      const txt = j?.choices?.[0]?.message?.content;
      if (!txt) return null;
      try { return JSON.parse(txt); } catch { return null; }
    }
    return j?.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.warn("[lovable-ai-proxy] error", (e as Error)?.message);
    return null;
  }
}

/** Convenience: structured-JSON call with a function tool schema. */
export async function lovableJson(system: string, user: string, schema?: any): Promise<any | null> {
  return lovableAi({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(schema
      ? { tools: [{ type: "function", function: schema }], tool_choice: { type: "function", function: { name: schema.name } } }
      : { response_format: { type: "json_object" } }),
  });
}
