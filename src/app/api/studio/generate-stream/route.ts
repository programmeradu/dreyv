import { NextRequest } from "next/server";
import { buildProviderChain, streamProvider, parseLLMResponse } from "@/lib/studio/ai-provider";
import { STUDIO_SYSTEM_PROMPT } from "@/lib/studio/system-prompt";
import { buildWeb3Context } from "@/lib/studio/web3-context";
import { checkRouteLimit } from "@/lib/rate-limit-middleware";

/**
 * POST /api/studio/generate-stream
 *
 * SSE streaming version of the Studio code generation endpoint.
 * Streams tokens in real-time for a Claude Code / Cursor-like experience.
 *
 * SSE events:
 *   data: {"type":"token","content":"..."} — partial token
 *   data: {"type":"meta","provider":"...","model":"..."} — provider info
 *   data: {"type":"done","files":{...},"explanation":"..."} — final parsed result
 *   data: {"type":"error","message":"..."} — error
 */

export async function POST(req: NextRequest) {
  // Rate limit
  const rateLimit = await checkRouteLimit(req, "ai_architect_runs");
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded", tier: rateLimit.tier }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await req.json();
  const { prompt, contextFiles, aiConfig, history } = body;

  if (!prompt) {
    return new Response(JSON.stringify({ error: "Prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Build full prompt with context
  let fullPrompt = prompt;

  // Inject conversation history (last 10 turns) for follow-up context
  if (Array.isArray(history) && history.length > 0) {
    const recent = history.slice(-10);
    const historyText = recent
      .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");
    fullPrompt = `[CONVERSATION HISTORY — previous turns in this session]\n${historyText}\n\n[CURRENT REQUEST]\n${prompt}`;
  }

  if (contextFiles && Object.keys(contextFiles).length > 0) {
    const manifest = Object.entries(contextFiles).map(([name, file]: [string, any]) => {
      const lines = (file.content || "").split("\n").length;
      return `  ${name}: ${lines} lines`;
    }).join("\n");

    const fileContext = Object.entries(contextFiles)
      .map(([name, file]: [string, any]) => `--- ${name} ---\n${file.content}\n`)
      .join("\n");

    fullPrompt = `${fullPrompt}\n\nPROJECT MANIFEST:\n${manifest}\n\nCURRENT FILES:\n${fileContext}`;
  }

  // Inject Web3 context
  const appCode = contextFiles?.["App.tsx"]?.content || "";
  const web3Ctx = buildWeb3Context({ code: appCode, prompt });
  if (web3Ctx.trim()) {
    fullPrompt += `\n\n[WEB3 CONTEXT]\n${web3Ctx}`;
  }

  const chain = buildProviderChain(aiConfig);
  if (chain.length === 0) {
    return new Response(
      JSON.stringify({ error: "no_api_key", details: "No AI API key configured." }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // SSE response
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      let fullResponse = "";
      let succeeded = false;

      for (const entry of chain) {
        try {
          send({ type: "meta", provider: entry.provider, model: entry.model });

          fullResponse = "";
          // Phase tracking: thinking (pre-fence) → code (inside fence) → summary (post-fence)
          let phase: "thinking" | "code" | "summary" = "thinking";

          for await (const token of streamProvider(entry.provider, entry.key, entry.model, STUDIO_SYSTEM_PROMPT, fullPrompt)) {
            fullResponse += token;
            // Always send raw token (legacy consumers)
            send({ type: "token", content: token });

            // Phase detection on the accumulated buffer
            if (phase === "thinking") {
              const fenceIdx = fullResponse.indexOf("```json");
              if (fenceIdx === -1) {
                // Still in thinking — stream the token to the thinking bubble
                send({ type: "thinking", content: token });
              } else {
                // Just crossed into code phase — emit any remaining pre-fence text once
                phase = "code";
                send({ type: "thinking_done" });
              }
            } else if (phase === "code") {
              // Look for closing fence after the opening one
              const openIdx = fullResponse.indexOf("```json");
              const closeIdx = openIdx >= 0 ? fullResponse.indexOf("```", openIdx + 7) : -1;
              if (closeIdx !== -1) {
                phase = "summary";
                send({ type: "summary_start" });
              }
            } else if (phase === "summary") {
              send({ type: "summary", content: token });
            }
          }

          succeeded = true;
          break;
        } catch (err: any) {
          console.warn(`[stream] ${entry.provider} failed: ${err.message}`);
          send({ type: "error", message: `${entry.provider} failed, trying next...`, recoverable: true });
        }
      }

      if (!succeeded) {
        send({ type: "error", message: "All providers failed" });
        controller.close();
        return;
      }

      // Parse the accumulated response
      const parsed = parseLLMResponse(fullResponse) || { files: {}, explanation: fullResponse };

      // Extract trailing markdown summary (text after the closing ``` fence)
      let trailingSummary = "";
      const openIdx = fullResponse.indexOf("```json");
      if (openIdx !== -1) {
        const closeIdx = fullResponse.indexOf("```", openIdx + 7);
        if (closeIdx !== -1) {
          trailingSummary = fullResponse.slice(closeIdx + 3).trim();
        }
      }

      // Detect patch arrays
      let isPatches = false;
      let patches: any[] | null = null;
      if (Array.isArray(parsed)) {
        isPatches = true;
        patches = parsed;
      } else if (Array.isArray(parsed.patches)) {
        isPatches = true;
        patches = parsed.patches;
      }

      send({
        type: "done",
        files: isPatches ? {} : (parsed.files || {}),
        explanation: parsed.explanation || "Code generated.",
        summary: trailingSummary || null,
        ...(isPatches && { isPatches: true, patches }),
      });

      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
