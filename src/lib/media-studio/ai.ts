/**
 * Generation wrapper for the Media Studio.
 *
 * Provider strategy (first match wins):
 *   1. GEMINI_API_KEY (or GOOGLE_AI_API_KEY / GOOGLE_GENAI_API_KEY) → Google AI
 *      Studio direct. Primary path on Vercel when set.
 *   2. GROQ_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / Cloudflare Workers AI
 *      as text fallbacks (image generation requires Gemini).
 *
 * We keep one place to swap models, retry, or log usage.
 */

// Vertex AI global publisher endpoint — accepts API keys via x-goog-api-key
// header and bills usage to the Cloud project (so GenAI App Builder / free-trial
// credits apply). Set GEMINI_USE_AI_STUDIO=1 to fall back to the AI Studio
// endpoint (generativelanguage.googleapis.com) which does NOT bill to GCP.
const VERTEX_API_BASE = "https://aiplatform.googleapis.com/v1/publishers/google/models";
const AI_STUDIO_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
function googleApiBase(): string {
  return process.env.GEMINI_USE_AI_STUDIO === "1" ? AI_STUDIO_API_BASE : VERTEX_API_BASE;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Provider =
  | "gemini"
  | "groq"
  | "openai"
  | "anthropic"
  | "cloudflare";

type ProviderEntry =
  | { provider: "gemini"; key: string }
  | { provider: "groq"; key: string; model: string }
  | { provider: "openai"; key: string; model: string }
  | { provider: "anthropic"; key: string; model: string }
  | { provider: "cloudflare"; accountId: string; token: string; model: string };

/**
 * Build a provider chain. The Studio works as long as ANY of these are set.
 */
function buildProviderChain(): ProviderEntry[] {
  const chain: ProviderEntry[] = [];

  const gem =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY;
  if (gem) chain.push({ provider: "gemini", key: gem });

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
      "No AI provider configured. Set one of: GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN.",
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
  const url = `${googleApiBase()}/${model}:generateContent`;
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
    headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
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
 * Shared body builder for the OpenAI-compatible chat-completions schema.
 */
function buildChatBody(opts: {
  model?: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model ?? "google/gemini-2.5-flash",
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

async function openaiCompatChatJson<T>(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
  supportsTools?: boolean;
  supportsJsonObject?: boolean;
  providerLabel: string;
}): Promise<T> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.schema && !opts.supportsTools
      ? [
          ...opts.messages.filter((m) => m.role !== "system"),
          { role: "system", content: `${opts.messages.find((m) => m.role === "system")?.content ?? ""}\n\nRespond ONLY with valid JSON matching this schema: ${JSON.stringify(opts.schema.parameters)}` },
        ]
      : opts.messages,
    temperature: opts.temperature ?? 0.7,
    stream: false,
  };
  if (opts.schema && opts.supportsTools) {
    body.tools = [{ type: "function", function: opts.schema }];
    body.tool_choice = { type: "function", function: { name: opts.schema.name } };
  } else if (opts.supportsJsonObject) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(opts.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${opts.providerLabel} ${res.status}: ${text.slice(0, 300)}`);
  }
  return parseChatJsonResponse<T>(await res.json(), Boolean(opts.schema && opts.supportsTools));
}

async function anthropicChatJson<T>(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  const system = opts.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const sysWithSchema = opts.schema
    ? `${system}\n\nRespond ONLY with valid JSON matching this schema: ${JSON.stringify(opts.schema.parameters)}`
    : `${system}\n\nRespond ONLY with valid JSON.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 4096,
      temperature: opts.temperature ?? 0.7,
      system: sysWithSchema,
      messages: opts.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const txt: string | undefined = data?.content?.[0]?.text;
  if (!txt) throw new Error("Anthropic returned no content");
  // Strip optional code fences
  const cleaned = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

async function callOne<T>(entry: ProviderEntry, opts: {
  model?: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  switch (entry.provider) {
    case "gemini":
      return googleChatJson<T>({
        model: opts.model ?? "google/gemini-2.5-flash",
        apiKey: entry.key,
        messages: opts.messages,
        schema: opts.schema,
        temperature: opts.temperature,
      });
    case "groq":
      return openaiCompatChatJson<T>({
        baseUrl: "https://api.groq.com/openai/v1/chat/completions",
        apiKey: entry.key,
        model: opts.model ?? entry.model,
        messages: opts.messages,
        schema: opts.schema,
        temperature: opts.temperature,
        supportsTools: false,
        supportsJsonObject: true,
        providerLabel: "Groq",
      });
    case "openai":
      return openaiCompatChatJson<T>({
        baseUrl: "https://api.openai.com/v1/chat/completions",
        apiKey: entry.key,
        model: opts.model ?? entry.model,
        messages: opts.messages,
        schema: opts.schema,
        temperature: opts.temperature,
        supportsTools: true,
        supportsJsonObject: true,
        providerLabel: "OpenAI",
      });
    case "anthropic":
      return anthropicChatJson<T>({
        apiKey: entry.key,
        model: opts.model ?? entry.model,
        messages: opts.messages,
        schema: opts.schema,
        temperature: opts.temperature,
      });
    case "cloudflare":
      return openaiCompatChatJson<T>({
        baseUrl: `https://api.cloudflare.com/client/v4/accounts/${entry.accountId}/ai/v1/chat/completions`,
        apiKey: entry.token,
        model: opts.model ?? entry.model,
        messages: opts.messages,
        schema: opts.schema,
        temperature: opts.temperature,
        supportsTools: false,
        supportsJsonObject: false,
        providerLabel: "Cloudflare AI",
      });
  }
}

export async function chatJson<T = unknown>(opts: {
  model?: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  const chain = buildProviderChain();
  if (chain.length === 0) pickProvider(); // throws standard error
  const errors: string[] = [];
  for (const entry of chain) {
    try {
      return await callOne<T>(entry, opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${entry.provider}: ${msg}`);
      // For rate/credit errors, try next provider; for everything else also try next.
      continue;
    }
  }
  throw new Error(`All AI providers failed. ${errors.join(" | ")}`);
}

/**
 * Generate an image. Only Gemini and Lovable AI support image output today;
 * if neither is configured we throw a clear error (text providers can't help).
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
  const chain = buildProviderChain().filter(
    (e) => e.provider === "gemini",
  );
  if (chain.length === 0) {
    throw new Error(
      "Image generation needs Gemini (GEMINI_API_KEY). Text providers like Groq/OpenAI/Anthropic can't generate images here.",
    );
  }
  const refs = opts.referenceImages ?? [];
  let lastErr: unknown = null;
  for (const picked of chain) {
    try {
      if (picked.provider === "gemini") {
        const apiKey = picked.key;
        const model = toGoogleModel(opts.model ?? "google/gemini-3.1-flash-image-preview", "image");
        const url = `${googleApiBase()}/${model}:generateContent`;
        const parts: Array<Record<string, unknown>> = [{ text: opts.prompt }];
        for (const r of refs) {
          parts.push({ inlineData: { mimeType: r.mime, data: r.buffer.toString("base64") } });
        }
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
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

    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Image generation failed");
}


