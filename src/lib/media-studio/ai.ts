/**
 * Generation wrapper for the Media Studio.
 *
 * Provider strategy (first match wins):
 *   1. GEMINI_API_KEY (or GOOGLE_AI_API_KEY / GOOGLE_GENAI_API_KEY) → Google AI
 *      Studio direct. Primary path on Vercel when set.
 *   2. LOVABLE_AI_PROXY_URL (or NEXT_PUBLIC_SUPABASE_URL) → Supabase edge
 *      function `lovable-ai-proxy` which forwards to the Lovable AI Gateway
 *      using the managed LOVABLE_API_KEY in the Lovable Cloud workspace.
 *      This lets Vercel use Lovable AI WITHOUT putting LOVABLE_API_KEY on Vercel.
 *   3. LOVABLE_API_KEY → Lovable AI Gateway direct. Only works in environments
 *      that have the key locally (e.g. dev with .env.local).
 *
 * We keep one place to swap models, retry, or log usage.
 */

const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Provider =
  | "gemini"
  | "lovable-proxy"
  | "lovable"
  | "groq"
  | "openai"
  | "anthropic"
  | "cloudflare";

type ProviderEntry =
  | { provider: "gemini"; key: string }
  | { provider: "lovable-proxy"; proxyUrl: string }
  | { provider: "lovable"; key: string }
  | { provider: "groq"; key: string; model: string }
  | { provider: "openai"; key: string; model: string }
  | { provider: "anthropic"; key: string; model: string }
  | { provider: "cloudflare"; accountId: string; token: string; model: string };

/** Resolve the Supabase edge-function URL for the lovable-ai-proxy, if available. */
function resolveProxyUrl(): string | null {
  const explicit = process.env.LOVABLE_AI_PROXY_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const supa =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  if (supa) return `${supa.replace(/\/+$/, "")}/functions/v1/lovable-ai-proxy`;
  return null;
}

/**
 * Build a provider chain. The Studio works as long as ANY of these are set —
 * Lovable AI is preferred but not required.
 */
function buildProviderChain(): ProviderEntry[] {
  const chain: ProviderEntry[] = [];

  const gem =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY;
  if (gem) chain.push({ provider: "gemini", key: gem });

  const proxyUrl = resolveProxyUrl();
  if (proxyUrl) chain.push({ provider: "lovable-proxy", proxyUrl });

  if (process.env.LOVABLE_API_KEY) {
    chain.push({ provider: "lovable", key: process.env.LOVABLE_API_KEY });
  }

  if (process.env.GROQ_API_KEY) {
    chain.push({
      provider: "groq",
      key: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    });
  }
  if (process.env.OPENAI_API_KEY) {
    chain.push({
      provider: "openai",
      key: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    chain.push({
      provider: "anthropic",
      key: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
    });
  }
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN) {
    chain.push({
      provider: "cloudflare",
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_AI_TOKEN,
      model: process.env.CLOUDFLARE_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    });
  }

  return chain;
}

function pickProvider(): ProviderEntry {
  const chain = buildProviderChain();
  if (chain.length === 0) {
    throw new Error(
      "No AI provider configured. Set one of: GEMINI_API_KEY, LOVABLE_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN. The lovable-ai-proxy edge function is auto-detected when SUPABASE_URL is set.",
    );
  }
  return chain[0]!;
}


/** Map our generic model id to a Google AI Studio model name. */
function toGoogleModel(model: string, kind: "text" | "image"): string {
  // Strip "google/" prefix if present
  const m = model.replace(/^google\//, "");
  if (kind === "image") {
    // Image-capable Gemini models on Google AI Studio
    if (m.includes("3-pro-image")) return "gemini-3-pro-image-preview";
    if (m.includes("3.1-flash-image")) return "gemini-3.1-flash-image-preview";
    if (m.includes("2.5-flash-image")) return "gemini-2.5-flash-image";
    return "gemini-2.5-flash-image";
  }
  // Text models — map preview/lovable names to AI Studio equivalents
  if (m.includes("3.1-pro")) return "gemini-2.5-pro";
  if (m.includes("3-flash") || m.includes("3.1-flash")) return "gemini-2.5-flash";
  if (m.startsWith("gemini-")) return m;
  return "gemini-2.5-flash";
}

function flattenMessages(messages: ChatMessage[]): { systemInstruction?: { parts: { text: string }[] }; contents: { role: "user" | "model"; parts: { text: string }[] }[] } {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n").trim();
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));
  return {
    systemInstruction: sys ? { parts: [{ text: sys }] } : undefined,
    contents,
  };
}

async function googleChatJson<T>(opts: {
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  const model = toGoogleModel(opts.model, "text");
  const url = `${GOOGLE_API_BASE}/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const { systemInstruction, contents } = flattenMessages(opts.messages);

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      responseMimeType: "application/json",
      ...(opts.schema ? { responseSchema: opts.schema.parameters } : {}),
    },
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Gemini is rate limited. Please try again shortly.");
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p?.text ?? "")
    .join("");
  if (!text) throw new Error("Gemini returned no content");
  return JSON.parse(text) as T;
}

/**
 * Shared body builder for the OpenAI-compatible chat-completions schema used by
 * both the Lovable AI Gateway and the lovable-ai-proxy edge function.
 */
function buildChatBody(opts: {
  model?: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model ?? "google/gemini-3-flash-preview",
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    stream: false,
  };
  if (opts.schema) {
    body.tools = [
      { type: "function", function: { name: opts.schema.name, description: opts.schema.description, parameters: opts.schema.parameters } },
    ];
    body.tool_choice = { type: "function", function: { name: opts.schema.name } };
  } else {
    body.response_format = { type: "json_object" };
  }
  return body;
}

function parseChatJsonResponse<T>(data: unknown, hasSchema: boolean): T {
  const root = data as { choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ function?: { arguments?: unknown } }> } }> };
  if (hasSchema) {
    const args = root?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (typeof args === "string") return JSON.parse(args) as T;
    throw new Error("AI gateway returned no tool call");
  }
  const content = root?.choices?.[0]?.message?.content;
  if (typeof content === "string") return JSON.parse(content) as T;
  throw new Error("AI gateway returned no content");
}

async function lovableChatJson<T>(opts: {
  model?: string;
  apiKey: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  const res = await fetch(LOVABLE_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildChatBody(opts)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Lovable AI is rate limited. Please try again shortly.");
    if (res.status === 402) throw new Error("Lovable AI credits are exhausted. Add credits in Workspace Usage.");
    throw new Error(`AI gateway ${res.status}: ${text.slice(0, 300)}`);
  }
  return parseChatJsonResponse<T>(await res.json(), Boolean(opts.schema));
}

async function proxyChatJson<T>(opts: {
  model?: string;
  proxyUrl: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  const res = await fetch(opts.proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildChatBody(opts)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Lovable AI is rate limited. Please try again shortly.");
    if (res.status === 402) throw new Error("Lovable AI credits are exhausted. Add credits in Workspace Usage.");
    throw new Error(`Lovable AI proxy ${res.status}: ${text.slice(0, 300)}`);
  }
  return parseChatJsonResponse<T>(await res.json(), Boolean(opts.schema));
}

export async function chatJson<T = unknown>(opts: {
  model?: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  const picked = pickProvider();
  if (picked.provider === "gemini") {
    return googleChatJson<T>({
      model: opts.model ?? "google/gemini-3-flash-preview",
      apiKey: picked.key as string,
      messages: opts.messages,
      schema: opts.schema,
      temperature: opts.temperature,
    });
  }
  if (picked.provider === "lovable-proxy") {
    return proxyChatJson<T>({ ...opts, proxyUrl: picked.proxyUrl as string });
  }
  return lovableChatJson<T>({ ...opts, apiKey: picked.key as string });
}

/**
 * Generate an image. Provider order: Gemini direct → lovable-ai-proxy
 * (Supabase edge function) → Lovable AI Gateway direct.
 */
export async function generateImage(opts: {
  prompt: string;
  model?: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
  /**
   * Optional reference images (e.g. mascot character sheets). When supplied
   * the model is instructed to compose new scenes around these characters
   * instead of inventing them. Buffers are base64-encoded inline.
   */
  referenceImages?: Array<{ buffer: Buffer; mime: string }>;
}): Promise<{ buffer: Buffer; mime: string }> {
  const picked = pickProvider();
  const refs = opts.referenceImages ?? [];

  if (picked.provider === "gemini") {
    const apiKey = picked.key as string;
    const model = toGoogleModel(opts.model ?? "google/gemini-3.1-flash-image-preview", "image");
    const url = `${GOOGLE_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const parts: Array<Record<string, unknown>> = [{ text: opts.prompt }];
    for (const r of refs) {
      parts.push({ inlineData: { mimeType: r.mime, data: r.buffer.toString("base64") } });
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Gemini is rate limited. Please try again shortly.");
      throw new Error(`Gemini image ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const respParts: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> =
      data?.candidates?.[0]?.content?.parts ?? [];
    for (const p of respParts) {
      const inline = (p.inlineData ?? p.inline_data) as { data?: string; mimeType?: string; mime_type?: string } | undefined;
      if (inline?.data) {
        const mime = inline.mimeType || inline.mime_type || "image/png";
        return { buffer: Buffer.from(inline.data, "base64"), mime };
      }
    }
    throw new Error("Gemini returned no image");
  }

  // Both lovable-proxy and lovable speak the same OpenAI-compatible body.
  const isProxy = picked.provider === "lovable-proxy";
  const endpoint = isProxy ? (picked.proxyUrl as string) : LOVABLE_GATEWAY_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!isProxy) headers.Authorization = `Bearer ${picked.key as string}`;

  const model = opts.model ?? "google/gemini-3.1-flash-image-preview";
  // OpenAI-compatible multimodal: content is an array of parts.
  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: opts.prompt }];
  for (const r of refs) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${r.mime};base64,${r.buffer.toString("base64")}` },
    });
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: refs.length > 0 ? userContent : opts.prompt }],
      modalities: ["image", "text"],
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Lovable AI is rate limited. Please try again shortly.");
    if (res.status === 402) throw new Error("Lovable AI credits are exhausted. Add credits in Workspace Usage.");
    throw new Error(`Lovable AI image ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const images = data?.choices?.[0]?.message?.images;
  const url: string | undefined = images?.[0]?.image_url?.url;
  if (!url) throw new Error("Lovable AI returned no image");
  const m = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!m) throw new Error("Lovable AI image was not a base64 data URL");
  const mime = m[1] ?? "image/png";
  const buffer = Buffer.from(m[2] ?? "", "base64");
  return { buffer, mime };
}

