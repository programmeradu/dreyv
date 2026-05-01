/**
 * Generation wrapper for the Media Studio.
 *
 * Provider strategy:
 *   1. If GEMINI_API_KEY (or GOOGLE_AI_API_KEY / GOOGLE_GENAI_API_KEY) is set,
 *      call Google AI Studio (Generative Language API) directly. This is the
 *      production path on Vercel where LOVABLE_API_KEY is not available.
 *   2. Otherwise fall back to the Lovable AI Gateway (LOVABLE_API_KEY).
 *
 * We keep one place to swap models, retry, or log usage.
 */

const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Provider = "gemini" | "lovable";

function pickProvider(): { provider: Provider; key: string } {
  const gem =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY;
  if (gem) return { provider: "gemini", key: gem };
  const lov = process.env.LOVABLE_API_KEY;
  if (lov) return { provider: "lovable", key: lov };
  throw new Error(
    "No AI provider configured. Set GEMINI_API_KEY (recommended for production) or LOVABLE_API_KEY.",
  );
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

async function lovableChatJson<T>(opts: {
  model?: string;
  apiKey: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  const model = opts.model ?? "google/gemini-3-flash-preview";
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.schema) {
    body.tools = [
      { type: "function", function: { name: opts.schema.name, description: opts.schema.description, parameters: opts.schema.parameters } },
    ];
    body.tool_choice = { type: "function", function: { name: opts.schema.name } };
  } else {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(LOVABLE_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Lovable AI is rate limited. Please try again shortly.");
    if (res.status === 402) throw new Error("Lovable AI credits are exhausted. Add credits in Workspace Usage.");
    throw new Error(`AI gateway ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  if (opts.schema) {
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (typeof args === "string") return JSON.parse(args) as T;
    throw new Error("AI gateway returned no tool call");
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return JSON.parse(content) as T;
  throw new Error("AI gateway returned no content");
}

export async function chatJson<T = unknown>(opts: {
  model?: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  const { provider, key } = pickProvider();
  if (provider === "gemini") {
    return googleChatJson<T>({
      model: opts.model ?? "google/gemini-3-flash-preview",
      apiKey: key,
      messages: opts.messages,
      schema: opts.schema,
      temperature: opts.temperature,
    });
  }
  return lovableChatJson<T>({ ...opts, apiKey: key });
}

/**
 * Generate an image. Uses Google AI Studio when GEMINI_API_KEY is set,
 * otherwise the Lovable AI gateway.
 */
export async function generateImage(opts: {
  prompt: string;
  model?: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
}): Promise<{ buffer: Buffer; mime: string }> {
  const { provider, key } = pickProvider();

  if (provider === "gemini") {
    const model = toGoogleModel(opts.model ?? "google/gemini-3.1-flash-image-preview", "image");
    const url = `${GOOGLE_API_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Gemini is rate limited. Please try again shortly.");
      throw new Error(`Gemini image ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const parts: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> =
      data?.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) {
        const mime = inline.mimeType || (p as { inline_data?: { mime_type?: string } }).inline_data?.mime_type || "image/png";
        return { buffer: Buffer.from(inline.data, "base64"), mime };
      }
    }
    throw new Error("Gemini returned no image");
  }

  const model = opts.model ?? "google/gemini-3.1-flash-image-preview";
  const res = await fetch(LOVABLE_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: opts.prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Lovable AI is rate limited. Please try again shortly.");
    if (res.status === 402) throw new Error("Lovable AI credits are exhausted. Add credits in Workspace Usage.");
    throw new Error(`AI gateway image ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const images = data?.choices?.[0]?.message?.images;
  const url: string | undefined = images?.[0]?.image_url?.url;
  if (!url) throw new Error("AI gateway returned no image");
  const m = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!m) throw new Error("AI gateway image was not a base64 data URL");
  const mime = m[1] ?? "image/png";
  const buffer = Buffer.from(m[2] ?? "", "base64");
  return { buffer, mime };
}
