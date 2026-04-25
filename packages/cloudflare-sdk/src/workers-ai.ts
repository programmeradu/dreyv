/**
 * Cloudflare Workers AI wrapper.
 *
 * Supports the OpenAI-compatible chat endpoint (`/ai/v1/chat/completions`)
 * AND the native model invocation endpoint (`/ai/run/{model}`).
 *
 * Used by Dreyv brain agents (triage / deep reasoning) when running on Cloudflare
 * inference instead of Groq, and by the Mini-App SDK for in-app inference.
 */

import { resolveConfig, authHeaders, cfFetch, type CFConfig } from "./_internal";

export interface WorkersAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface WorkersAIChatOptions {
  model: string; // e.g. "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  messages: WorkersAIChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  config?: Partial<CFConfig>;
}

export interface WorkersAIChatResult {
  text: string;
  raw: unknown;
}

function aiBase(cfg: CFConfig): string {
  return `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai`;
}

export async function chat(opts: WorkersAIChatOptions): Promise<WorkersAIChatResult> {
  const cfg = resolveConfig(opts.config);
  const url = `${aiBase(cfg)}/v1/chat/completions`;
  const res = await cfFetch<any>(url, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1024,
      stream: false,
    }),
  });
  const text = res?.choices?.[0]?.message?.content ?? "";
  return { text, raw: res };
}

export interface WorkersAIRunOptions {
  model: string;
  input: Record<string, unknown>;
  config?: Partial<CFConfig>;
}

export async function run(opts: WorkersAIRunOptions): Promise<unknown> {
  const cfg = resolveConfig(opts.config);
  const url = `${aiBase(cfg)}/run/${opts.model}`;
  return cfFetch(url, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(opts.input),
  });
}

export interface WorkersAIEmbedOptions {
  model?: string; // default "@cf/baai/bge-base-en-v1.5"
  texts: string[];
  config?: Partial<CFConfig>;
}

export async function embed(opts: WorkersAIEmbedOptions): Promise<number[][]> {
  const model = opts.model ?? "@cf/baai/bge-base-en-v1.5";
  const res = await run({ model, input: { text: opts.texts }, config: opts.config });
  const data: number[][] | undefined = (res as any)?.result?.data ?? (res as any)?.data;
  if (!Array.isArray(data)) {
    throw new Error("[@dreyv/cloudflare] workers-ai.embed returned no embeddings");
  }
  return data;
}

export interface WorkersAIImageOptions {
  model?: string; // default "@cf/black-forest-labs/flux-1-schnell"
  prompt: string;
  steps?: number;
  config?: Partial<CFConfig>;
}

export async function image(opts: WorkersAIImageOptions): Promise<{ base64: string; raw: unknown }> {
  const model = opts.model ?? "@cf/black-forest-labs/flux-1-schnell";
  const res = await run({
    model,
    input: { prompt: opts.prompt, steps: opts.steps ?? 4 },
    config: opts.config,
  });
  const base64: string =
    (res as any)?.result?.image ?? (res as any)?.image ?? "";
  return { base64, raw: res };
}

export const workersAi = { chat, run, embed, image };
