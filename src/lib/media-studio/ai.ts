/**
 * Thin wrapper around the Lovable AI Gateway for the Media Studio.
 *
 * All media-studio generation routes go through this so we have one place
 * to swap models, add retries, or log usage.
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function getKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  return key;
}

export async function chatJson<T = unknown>(opts: {
  model?: string;
  messages: ChatMessage[];
  schema?: { name: string; description?: string; parameters: Record<string, unknown> };
  temperature?: number;
}): Promise<T> {
  const model = opts.model ?? "google/gemini-2.5-flash";
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

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${getKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
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

/**
 * Generate an image via the Lovable AI gateway image endpoint.
 * Returns a base64-encoded PNG buffer + mime type.
 */
export async function generateImage(opts: {
  prompt: string;
  model?: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
}): Promise<{ buffer: Buffer; mime: string }> {
  const model = opts.model ?? "google/gemini-3.1-flash-image-preview";
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${getKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: opts.prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI gateway image ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const images = data?.choices?.[0]?.message?.images;
  const url: string | undefined = images?.[0]?.image_url?.url;
  if (!url) throw new Error("AI gateway returned no image");
  // Data URL: data:image/png;base64,XXXX
  const m = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!m) throw new Error("AI gateway image was not a base64 data URL");
  const mime = m[1] ?? "image/png";
  const buffer = Buffer.from(m[2] ?? "", "base64");
  return { buffer, mime };
}
