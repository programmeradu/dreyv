// @ts-nocheck
// Lovable AI Proxy
// ----------------
// Forwards chat completion requests from any client (Vercel/Next.js, Studio,
// CommandBar, Media Studio, etc.) to the Lovable AI Gateway using the
// managed LOVABLE_API_KEY that lives in this Supabase workspace.
//
// Why: LOVABLE_API_KEY cannot be exposed on Vercel. This proxy keeps the key
// server-side here while letting any frontend opt into Lovable AI models.
//
// Body: { model?, messages, tools?, tool_choice?, stream?, reasoning?, response_format? }
// Behaviour: streams SSE back when stream=true, otherwise returns JSON.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

interface ProxyBody {
  model?: string;
  messages?: ChatMessage[];
  tools?: unknown;
  tool_choice?: unknown;
  stream?: boolean;
  reasoning?: { effort?: string };
  response_format?: unknown;
  temperature?: number;
  max_tokens?: number;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.error("lovable-ai-proxy: LOVABLE_API_KEY not configured");
    return jsonResponse({ error: "LOVABLE_API_KEY is not configured" }, 500);
  }

  let payload: ProxyBody;
  try {
    payload = (await req.json()) as ProxyBody;
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return jsonResponse({ error: "`messages` must be a non-empty array" }, 400);
  }

  const model = payload.model || DEFAULT_MODEL;
  const stream = payload.stream !== false; // default to streaming

  const upstreamBody: Record<string, unknown> = {
    model,
    messages: payload.messages,
    stream,
  };
  if (payload.tools) upstreamBody.tools = payload.tools;
  if (payload.tool_choice) upstreamBody.tool_choice = payload.tool_choice;
  if (payload.reasoning) upstreamBody.reasoning = payload.reasoning;
  if (payload.response_format) upstreamBody.response_format = payload.response_format;
  if (typeof payload.temperature === "number") upstreamBody.temperature = payload.temperature;
  if (typeof payload.max_tokens === "number") upstreamBody.max_tokens = payload.max_tokens;

  let upstream: Response;
  try {
    upstream = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (e) {
    console.error("lovable-ai-proxy: upstream fetch failed", e);
    return jsonResponse({ error: "Failed to reach Lovable AI gateway" }, 502);
  }

  // Surface common gateway errors with the original status so callers can
  // show the right toast (rate limit vs. credits vs. generic).
  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("lovable-ai-proxy: upstream error", upstream.status, text);

    if (upstream.status === 429) {
      return jsonResponse(
        { error: "Rate limit exceeded, please try again in a moment." },
        429,
      );
    }
    if (upstream.status === 402) {
      return jsonResponse(
        {
          error:
            "Lovable AI credits exhausted. Add funds in Settings → Workspace → Usage.",
        },
        402,
      );
    }
    return jsonResponse(
      { error: "Lovable AI gateway error", detail: text.slice(0, 500) },
      upstream.status,
    );
  }

  // Streaming response: pipe the SSE body straight back to the client.
  if (stream && upstream.body) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // Non-streaming: forward JSON body verbatim.
  const data = await upstream.json();
  return jsonResponse(data, 200);
});
