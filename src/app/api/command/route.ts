import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { estimateCompatibilityBudget } from "@/lib/llm/model-compatibility";
import { buildLegacyTools, buildCapabilityContext } from "@/lib/agents/capabilities/legacy-shim";
import { buildCommandBarSystemPrompt, STRICT_GROUNDING_ADDENDUM } from "@/lib/agents/commandbar/system-prompt";
import { summarizeYieldForLLM, fetchLiveLstRates } from "@/lib/foresight/lst-yield";
import { summarizeYieldRoutesForLLM } from "@/lib/agents/capabilities/yield-routes";
import {
  summarizePendingProposals,
  summarizeActiveAlerts,
  summarizeActivePolicy,
  summarizeRecentActions,
} from "@/lib/agents/capabilities/app-control";

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

// Cloudflare Workers AI fallback — use openai-compatible provider so streaming works (createOpenAI returns v1-style and is rejected by AI SDK 5+)
const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfToken = process.env.CLOUDFLARE_AI_TOKEN;
const cloudflareProvider =
  cfAccountId && cfToken
    ? createOpenAICompatible({
        name: "cloudflare",
        apiKey: cfToken,
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/v1`,
      })
    : null;

const CLOUDFLARE_FALLBACK_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/meta/llama-3.1-8b-instruct",
];

// Lovable AI Gateway — auto-provisioned (LOVABLE_API_KEY set by Lovable Cloud).
// OpenAI-compatible, supports streaming + tool calls.
const lovableApiKey = process.env.LOVABLE_API_KEY;
const lovableProvider = lovableApiKey
  ? createOpenAICompatible({
      name: "lovable",
      apiKey: lovableApiKey,
      baseURL: "https://ai.gateway.lovable.dev/v1",
    })
  : null;

// Lovable AI via Supabase edge-function proxy — lets Vercel use Lovable AI
// WITHOUT placing LOVABLE_API_KEY on Vercel. The proxy forwards to the gateway
// using the managed key in the Lovable Cloud workspace.
function resolveLovableProxyBase(): string | null {
  const explicit = process.env.LOVABLE_AI_PROXY_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const supa =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  if (supa) return `${supa.replace(/\/+$/, "")}/functions/v1/lovable-ai-proxy`;
  return null;
}
const lovableProxyBase = resolveLovableProxyBase();
const lovableProxyProvider = lovableProxyBase
  ? createOpenAICompatible({
      name: "lovable-proxy",
      // The edge function reads LOVABLE_API_KEY server-side; no auth needed
      // from the client. We pass a placeholder because the SDK requires one.
      apiKey: "supabase-edge-managed",
      baseURL: lovableProxyBase,
    })
  : null;

const LOVABLE_FALLBACK_MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "openai/gpt-5-mini",
];

// Rate-limit cooldown cache — skip providers that recently returned 429
const rateLimitCooldown: Record<string, number> = {};

function isRateLimited(providerKey: string): boolean {
  const until = rateLimitCooldown[providerKey];
  if (!until) return false;
  if (Date.now() < until) return true;
  delete rateLimitCooldown[providerKey]; // expired
  return false;
}

function setRateLimitCooldown(providerKey: string, retryAfterSec?: number) {
  // Default 2-minute cooldown; use retry-after header if available
  const cooldownMs = (retryAfterSec ?? 120) * 1000;
  rateLimitCooldown[providerKey] = Date.now() + cooldownMs;
  const mins = Math.ceil(cooldownMs / 60000);
  console.log(`[Command API] ${providerKey} rate-limited, skipping for ~${mins}min`);
}

const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  WSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZxHZCGCRaeLJZoFpK6XNbRIo5jZbGT5",
  ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  JITO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  BSOL: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  STSOL: "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  TRUMP: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", // OFFICIAL TRUMP (Jupiter liquidity)
};

function resolveTokenMint(symbol: string): string | null {
  return TOKEN_MINTS[symbol.toUpperCase()] || null;
}

function tokenDecimals(symbol: string): number {
  return ["USDC", "USDT"].includes(symbol.toUpperCase()) ? 6 : 9;
}

function extractLatestUserText(messages: any[] | undefined, prompt?: string): string {
  if (prompt && typeof prompt === "string" && prompt.trim()) return prompt.trim();
  if (!Array.isArray(messages) || messages.length === 0) return "";

  const partsToText = (parts: any): string => {
    if (typeof parts === "string") return parts;
    if (!Array.isArray(parts)) return "";
    return parts
      .map((p: any) => {
        if (typeof p === "string") return p;
        // AI SDK v5: { type: 'text', text: '...' }
        if (p?.type === "text" && typeof p.text === "string") return p.text;
        if (typeof p?.text === "string") return p.text;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  };

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;

    // AI SDK v5 uses `parts`; legacy/v4 uses `content` (string or array).
    const fromParts = partsToText(msg?.parts);
    if (fromParts.trim()) return fromParts;

    if (typeof msg?.content === "string" && msg.content.trim()) return msg.content;
    const fromContent = partsToText(msg?.content);
    if (fromContent.trim()) return fromContent;
  }

  return "";
}

type PromptMode = "auto" | "build" | "execute";

import {
  type EvidenceClass,
  type GroundingGateResult,
  isSimpleConversation,
  isWalletProviderSupportQuestion,
  classifyEvidenceNeed,
  validateNavigationPath,
  buildBudgetedMessages,
  buildBudgetedMessagesWithCap,
  evaluateGroundingGate,
} from "./grounding";

function parsePromptMode(userText: string): PromptMode {
  const t = userText.trim().toLowerCase();
  if (/^(mode\s*:\s*build|\/build\b|#build\b|\[build\]|build mode\b)/.test(t)) return "build";
  if (/^(mode\s*:\s*execute|\/execute\b|#execute\b|\[execute\]|execute mode\b)/.test(t)) return "execute";
  return "auto";
}

function normalizeStudioProject(project: any) {
  if (!project?.id) return null;
  return {
    appId: project.id,
    name: project.name || "Untitled App",
    studioPath: `/app/studio?appId=${encodeURIComponent(project.id)}`,
    publicUrl: `/app/run/${encodeURIComponent(project.id)}`,
    ownerWallet: project.creatorWallet || null,
    updatedAt: project.updatedAt || null,
  };
}


export async function POST(req: Request) {
  try {
    // ─── Auth gate: require valid SIWS / Neon-Auth session ───────────
    const { getAuthUser } = await import('@/lib/auth-utils');
    const authUser = await getAuthUser(req as any);
    if (!authUser) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized. Please sign in.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json();
    const { messages, prompt, walletState, vaultState, vaultAddress, focusContext, agentPushes } = body;
    // Always trust the authenticated session wallet — never the request body.
    const walletAddress = authUser.walletAddress;
    const strictGroundingGlobal = process.env.STRICT_GROUNDING === "1" || process.env.STRICT_GROUNDING === "true";
    const strictGroundingWallets = (process.env.STRICT_GROUNDING_WALLETS || "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    const strictGrounding =
      strictGroundingGlobal ||
      (!!walletAddress && strictGroundingWallets.includes(walletAddress));

    const formattedMessages = await convertToModelMessages(messages || []);

    // Build yield context (LSTs + tokenized stable yields the treasury currently earns).
    // Pulled from vaultState.tokens passed by the client; live APYs fetched from
    // the in-memory cached /api/yield/rates feed. Never fabricates: if no
    // yield-bearing positions exist, the helper returns an explicit "no yield" line.
    let yieldContext: string | undefined;
    try {
      const tokens = Array.isArray((vaultState as any)?.tokens) ? (vaultState as any).tokens : [];
      if (tokens.length > 0) {
        const origin = req.headers.get("origin") || `https://${req.headers.get("host") || ""}`;
        const liveRates = await fetchLiveLstRates(undefined, origin || undefined).catch(() => ({}));
        yieldContext = summarizeYieldForLLM(
          tokens.map((t: any) => ({
            symbol: t.symbol ?? "",
            mint: t.mint ?? t.address ?? undefined,
            amount: Number(t.amount ?? 0),
            priceUsd: Number(t.price ?? t.priceUsd ?? 0),
          })),
          liveRates,
        );
      }
    } catch (e) {
      console.warn("[command] yield context build failed", e);
    }

    // Yield-routes context: armed/active routes for the LLM to reason about
    // ("you have 2 armed routes ready to deploy on next inflow").
    let yieldRoutesContext: string | undefined;
    let pendingProposalsContext: string | undefined;
    let activeAlertsContext: string | undefined;
    let activePolicyContext: string | undefined;
    let recentActionsContext: string | undefined;
    try {
      [yieldRoutesContext, pendingProposalsContext, activeAlertsContext, activePolicyContext, recentActionsContext] = await Promise.all([
        summarizeYieldRoutesForLLM(vaultAddress || walletAddress).catch(() => undefined),
        summarizePendingProposals(walletAddress).catch(() => undefined),
        summarizeActiveAlerts(walletAddress).catch(() => undefined),
        summarizeActivePolicy(walletAddress).catch(() => undefined),
        summarizeRecentActions(walletAddress).catch(() => undefined),
      ]);
    } catch (e) {
      console.warn("[command] universal context build failed", e);
    }

    let userFocusContext: string | undefined;
    try {
      const { formatFocusForLLM } = await import("@/lib/commandbar/focus-context");
      userFocusContext = formatFocusForLLM(focusContext);
    } catch { /* ignore */ }

    // Phase 7 — fold in any agent push events buffered on the client since
    // the previous turn (autopilot runs, new proposals, recent tool errors).
    let agentPushContext: string | undefined;
    if (Array.isArray(agentPushes) && agentPushes.length > 0) {
      const lines = agentPushes.slice(-10).map((p: any) => {
        if (!p || typeof p !== "object") return "";
        if (p.kind === "proposal") return `PUSH proposal id=${p.id} title="${p.title}" status=${p.status}`;
        if (p.kind === "autopilot_run") return `PUSH autopilot job=${p.jobId} status=${p.status} vault=${p.vaultId}`;
        if (p.kind === "tool_error") return `PUSH tool_error capability=${p.capabilityId} code=${p.errorCode || "?"}`;
        return "";
      }).filter(Boolean);
      if (lines.length) agentPushContext = `RECENT AGENT EVENTS:\n${lines.join("\n")}`;
    }

    const systemPrompt = buildCommandBarSystemPrompt({
      walletAddress,
      vaultState,
      walletState,
      yieldContext,
      yieldRoutesContext,
      pendingProposalsContext,
      activeAlertsContext,
      activePolicyContext,
      recentActionsContext,
      userFocusContext,
      agentPushContext,
    });
    const effectiveSystemPrompt = strictGrounding
      ? `${systemPrompt}\n\n${STRICT_GROUNDING_ADDENDUM}`
      : systemPrompt;

    const rpcEndpoint =
      process.env.HELIUS_API_KEY
        ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
        : "https://api.mainnet-beta.solana.com";

    const userRequestText = extractLatestUserText(messages, prompt);
    const lowerUserRequest = userRequestText.toLowerCase();
    const promptMode = parsePromptMode(userRequestText);
    const simpleConversation = isSimpleConversation(userRequestText);
    const walletSupportQuestion = isWalletProviderSupportQuestion(userRequestText);
    const evidenceClass = classifyEvidenceNeed(userRequestText);
    const observedGrounding = {
      lookupSuccess: false,
      navigationSuccess: false,
    };
    const hasHalfDirective = /\bhalf\b/.test(lowerUserRequest);
    const hasRestDirective = /\b(rest|remaining|remainder)\b/.test(lowerUserRequest);
    const hasSplitBridgeDepositFlow =
      /\bswap\b/.test(lowerUserRequest) &&
      /\bbridge\b/.test(lowerUserRequest) &&
      /\bdeposit\b/.test(lowerUserRequest) &&
      hasHalfDirective &&
      hasRestDirective;

    const inferredBuildIntent =
      /\b(build|create|develop|generate|initialize|make|code|prototype)\b/.test(lowerUserRequest) &&
      /\b(bot|app|mini-?app|script|automation|agent)\b/.test(lowerUserRequest);
    const isStudioBuildIntent = promptMode === "build" || (promptMode === "auto" && inferredBuildIntent);

    // ─── DACS Phase 6 — primary submission ────────────────────────────
    // Fire-and-forget: publishes `agent.command.submitted` to the bus so the
    // command-router → planner → executor pipeline can run in parallel with
    // the user-facing stream. The Phase 1 shadow diff-log was removed at
    // cutover; downstream consumers subscribe directly to the bus.
    if (userRequestText.trim().length > 0) {
      void (async () => {
        try {
          const { submitCommand } = await import("@/lib/agents/dacs/submit");
          await submitCommand({
            walletAddress,
            vaultAddress: vaultAddress || null,
            rawText: userRequestText,
            promptMode,
            vaultState,
            walletState,
          });
        } catch (e) {
          console.warn("[DACS] submit failed:", e);
        }
      })();
    }

    const executionState: {
      lastSwap: null | {
        inputToken: string;
        outputToken: string;
        inputAmount: number;
        outputAmount: number;
      };
      splitFirstLegApplied: boolean;
      splitRemaining: number | null;
    } = {
      lastSwap: null,
      splitFirstLegApplied: false,
      splitRemaining: null,
    };

    const resolveSplitAmount = (token: string, requestedAmount: number) => {
      if (!hasSplitBridgeDepositFlow || !executionState.lastSwap) {
        return { amount: requestedAmount, adjusted: false as const, reason: undefined as string | undefined };
      }

      if (executionState.lastSwap.outputToken.toUpperCase() !== token.toUpperCase()) {
        return { amount: requestedAmount, adjusted: false as const, reason: undefined as string | undefined };
      }

      const totalOut = executionState.lastSwap.outputAmount;
      if (!Number.isFinite(totalOut) || totalOut <= 0) {
        return { amount: requestedAmount, adjusted: false as const, reason: undefined as string | undefined };
      }

      if (executionState.splitRemaining === null) {
        executionState.splitRemaining = totalOut;
      }

      if (!executionState.splitFirstLegApplied) {
        const half = totalOut / 2;
        executionState.splitFirstLegApplied = true;
        executionState.splitRemaining = Math.max(0, totalOut - half);

        if (Math.abs(requestedAmount - half) > Math.max(0.01, half * 0.005)) {
          return {
            amount: half,
            adjusted: true as const,
            reason: "Adjusted to 50% of realized swap output for half/rest workflow.",
          };
        }
        return { amount: requestedAmount, adjusted: false as const, reason: undefined as string | undefined };
      }

      const remaining = Math.max(0, executionState.splitRemaining || 0);
      executionState.splitRemaining = 0;
      if (Math.abs(requestedAmount - remaining) > Math.max(0.01, remaining * 0.005)) {
        return {
          amount: remaining,
          adjusted: true as const,
          reason: "Adjusted to remaining realized swap output for half/rest workflow.",
        };
      }
      return { amount: requestedAmount, adjusted: false as const, reason: undefined as string | undefined };
    };

    const blockExecutionForBuildIntent = (operation: string) => {
      if (!isStudioBuildIntent) return null;
      return {
        success: false,
        operation,
        status: "BLOCKED_IN_BUILD_MODE",
        requiresApproval: false,
        mode: promptMode,
        message:
          "Build intent detected. Financial execution tools are blocked while scaffolding software. Use Studio tools (e.g. studio_init_miniapp). Prefix with mode:execute (or /execute) to allow live treasury execution.",
      };
    };

    // ─── DACS Phase 6 — capabilities sourced from the registry ────────
    // Replaces the inline 1,900-line `dreyvTools` object that lived here
    // pre-cutover. Behavior is byte-for-byte preserved (see capability
    // domain modules in `src/lib/agents/capabilities/*`); the registry is the
    // single source of truth for both the user-facing `/api/command` stream
    // and the bus-driven DACS pipeline (planner / router / executor).
    const capabilityCtx = buildCapabilityContext({
      walletAddress,
      rpcEndpoint,
      vaultAddress: vaultAddress || null,
      vaultState,
      walletState,
      executionState: executionState as never,
      promptMode,
      isStudioBuildIntent,
      blockExecutionForBuildIntent: blockExecutionForBuildIntent as never,
      resolveSplitAmount,
    });
    const registryTools = buildLegacyTools(capabilityCtx);

    const budgeted = buildBudgetedMessages(formattedMessages);
    const strictToolSubset =
      strictGrounding && evidenceClass === "db_required"
        ? {
            get_project_by_id: registryTools.get_project_by_id,
            get_project_by_name: registryTools.get_project_by_name,
            list_recent_projects: registryTools.list_recent_projects,
            get_studio_project_link: registryTools.get_studio_project_link,
            navigate: registryTools.navigate,
            mcp_verify: registryTools.mcp_verify,
          }
        : strictGrounding && evidenceClass === "navigation_required"
          ? {
              get_project_by_id: registryTools.get_project_by_id,
              get_project_by_name: registryTools.get_project_by_name,
              list_recent_projects: registryTools.list_recent_projects,
              get_studio_project_link: registryTools.get_studio_project_link,
              navigate: registryTools.navigate,
            }
          : registryTools;
    if (budgeted.reduced) {
      console.warn(
        `[Command API] Prompt budget reduction applied (evidenceClass=${evidenceClass}, chars=${JSON.stringify(formattedMessages).length}).`,
      );
    }

    const streamOptions = {
      system: effectiveSystemPrompt,
      messages: budgeted.messages,
      stopWhen: stepCountIs(10),
        ...(simpleConversation || walletSupportQuestion || evidenceClass === "conversational" ? {} : { tools: strictToolSubset }),
      ...(
        strictGrounding &&
        !simpleConversation &&
        (evidenceClass === "db_required" || evidenceClass === "navigation_required")
          ? { toolChoice: "required" as const }
          : {}
      ),
      onFinish: async () => {
        const gate = evaluateGroundingGate(evidenceClass, observedGrounding);
        console.log(
          `[Command API] grounding decision strict=${strictGrounding} class=${evidenceClass} allowed=${gate.allowed} reason=${gate.blockedReason || "none"} lookup=${observedGrounding.lookupSuccess} nav=${observedGrounding.navigationSuccess}`,
        );
      },
    };

    // Model chain order (per product decision):
    //   1. Groq (primary — fastest + cheapest at scale)
    //   2. Cloudflare Workers AI (secondary — high free tier, good 70B fallback)
    //   3. Lovable AI via Supabase proxy (tertiary on Vercel — uses managed key, no Vercel secrets)
    //   4. Lovable AI Gateway direct (last-resort — only when LOVABLE_API_KEY is local)
    const modelChain: { name: string; model: Parameters<typeof streamText>[0]["model"]; maxChars: number }[] = [];
    if (process.env.GROQ_API_KEY) {
      modelChain.push({
        name: "groq/llama-3.3-70b-versatile",
        model: groq("llama-3.3-70b-versatile"),
        maxChars: estimateCompatibilityBudget("groq/llama-3.3-70b-versatile"),
      });
    }
    if (cloudflareProvider) {
      for (const modelId of CLOUDFLARE_FALLBACK_MODELS) {
        const modelName = `cloudflare/${modelId}`;
        modelChain.push({
          name: modelName,
          model: cloudflareProvider.chatModel(modelId),
          maxChars: estimateCompatibilityBudget(modelName),
        });
      }
    }
    if (lovableProxyProvider) {
      for (const modelId of LOVABLE_FALLBACK_MODELS) {
        const modelName = `lovable-proxy/${modelId}`;
        modelChain.push({
          name: modelName,
          model: lovableProxyProvider.chatModel(modelId),
          maxChars: estimateCompatibilityBudget(`lovable/${modelId}`),
        });
      }
    }
    if (lovableProvider) {
      for (const modelId of LOVABLE_FALLBACK_MODELS) {
        const modelName = `lovable/${modelId}`;
        modelChain.push({
          name: modelName,
          model: lovableProvider.chatModel(modelId),
          maxChars: estimateCompatibilityBudget(modelName),
        });
      }
    }

    if (modelChain.length === 0) {
      return new Response(
        JSON.stringify({ error: "No AI provider configured. Set GROQ_API_KEY, CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN, NEXT_PUBLIC_SUPABASE_URL (for the lovable-ai-proxy edge function), or LOVABLE_API_KEY." }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    function extractRetryAfter(msg: string): number | undefined {
      const m = msg.match(/try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
      if (!m) return undefined;
      return (parseInt(m[1] || "0") * 3600) + (parseInt(m[2] || "0") * 60) + parseFloat(m[3] || "0");
    }

    function detectRateLimit(err: unknown): boolean {
      const msg = err instanceof Error ? err.message : String(err);
      const reason = (err as { reason?: string })?.reason;
      return (
        msg.includes("Rate limit") ||
        msg.includes("rate_limit") ||
        msg.includes("429") ||
        msg.includes("maxRetriesExceeded") ||
        msg.includes("Provider error in stream") ||
        reason === "maxRetriesExceeded" ||
        (err as Error)?.name === "AI_RetryError" ||
        (err as Error)?.name === "AI_APICallError"
      );
    }

    function detectToolValidationErrorMessage(msg: string): boolean {
      return /tool call validation failed|was not in request\.tools|invalid_request_error/i.test(msg);
    }

    function detectPromptLengthError(err: unknown): boolean {
      const msg = err instanceof Error ? err.message : String(err);
      return /reduce the length of the messages|context length|prompt is too long|maximum context|token limit/i.test(msg);
    }

    let lastError: unknown = null;
    let allFailuresWereToolValidation = true;
    let anyAttemptMade = false;
    for (let i = 0; i < modelChain.length; i++) {
      const { name, model, maxChars } = modelChain[i];
      // Skip providers that are in rate-limit cooldown
      if (isRateLimited(name)) {
        console.log(`[Command API] Skipping ${name} (rate-limited, cooldown active)`);
        continue;
      }
      try {
        anyAttemptMade = true;
        console.log(`[Command API] Trying model: ${name}`);
        const modelBudgeted = buildBudgetedMessagesWithCap(budgeted.messages, maxChars);
        const result = streamText({ ...streamOptions, messages: modelBudgeted.messages, model, maxRetries: 0 });

        // The AI SDK throws provider errors (e.g. 429) asynchronously.
        // The error surfaces on result.text / result.response promises, NOT on reader.read().
        // We race the first UI stream chunk against the error promise to catch it.
        const response = result.toUIMessageStreamResponse();
        const body = response.body;
        if (!body) {
          if (name !== "groq/llama-3.3-70b-versatile") {
            console.log(`[Command API] Using fallback model: ${name}`);
          }
          return response;
        }

        const reader = body.getReader();

        // Race: first stream chunk vs provider error
        // result.response rejects if the provider returns an error (429, etc.)
        const errorPromise = Promise.resolve(result.response).then(() => null, (e: unknown) => e);
        const chunkPromise = reader.read();

        const raceResult = await Promise.race([
          chunkPromise.then(r => ({ type: "chunk" as const, ...r })),
          errorPromise.then((e: unknown) => e ? { type: "error" as const, error: e } : null),
        ].filter(Boolean));

        if (raceResult && typeof raceResult === "object" && "type" in raceResult) {
          if (raceResult.type === "error") {
            reader.releaseLock();
            throw (raceResult as { error: unknown }).error;
          }
        }

        // First chunk arrived successfully. Also check for inline error content.
        const firstRead = raceResult as { type: "chunk"; value?: Uint8Array; done: boolean };
        if (firstRead.value) {
          const text = new TextDecoder().decode(firstRead.value);
          if (/rate.?limit|429|rate_limit_exceeded|limit reached/i.test(text) && text.length < 500) {
            reader.releaseLock();
            throw new Error(`Provider stream error from ${name}: ${text.slice(0, 300)}`);
          }
          if (detectToolValidationErrorMessage(text) && text.length < 2000) {
            reader.releaseLock();
            throw new Error(`Provider tool-call stream error from ${name}: ${text.slice(0, 500)}`);
          }
        }

        // Provider is confirmed working — re-assemble the stream
        const finalStream = new ReadableStream({
          start(controller) {
            if (firstRead.value) controller.enqueue(firstRead.value);
            if (firstRead.done) {
              controller.close();
              return;
            }
            (async () => {
              try {
                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  if (value) controller.enqueue(value);
                }
              } finally {
                reader.releaseLock();
              }
              controller.close();
            })();
          },
        });

        if (name !== "groq/llama-3.3-70b-versatile") {
          console.log(`[Command API] Using fallback model: ${name}`);
        }
        return new Response(finalStream, {
          headers: response.headers,
          status: response.status,
        });
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const rl = detectRateLimit(err);
        const lengthErr = detectPromptLengthError(err);
        const toolErr = detectToolValidationErrorMessage(msg);
        if (!toolErr) allFailuresWereToolValidation = false;
        if (rl) {
          setRateLimitCooldown(name, extractRetryAfter(msg));
        }
        if (lengthErr) {
          console.warn(`[Command API] ${name} rejected prompt length; trying fallback with tighter context.`);
        }
        console.warn(
          `[Command API] ${name} failed${rl ? " (rate limit)" : lengthErr ? " (prompt length)" : toolErr ? " (tool-call validation)" : ""}: ${msg.slice(0, 300)}`,
        );
        if (i < modelChain.length - 1) {
          console.log(`[Command API] Trying next model in fallback chain...`);
        } else {
          console.error(`[Command API] All ${modelChain.length} models exhausted.`);
        }
      }
    }

    // ─── Tool-call recovery pass ──────────────────────────────────────────
    // If every provider in the chain rejected the request due to tool-call
    // validation (model emitted a tool name/shape the provider didn't accept),
    // re-run the FIRST available non-rate-limited provider WITHOUT `tools`.
    // This guarantees the user gets a natural-language answer / plan instead
    // of a silent failure — aligned with "find a way to perform the action,
    // no matter what."
    if (anyAttemptMade && allFailuresWereToolValidation) {
      console.warn("[Command API] All providers failed with tool-call validation. Retrying without tools (recovery pass).");
      const { tools: _droppedTools, toolChoice: _droppedToolChoice, ...streamOptionsNoTools } =
        streamOptions as Record<string, unknown>;
      void _droppedTools;
      void _droppedToolChoice;
      const recoverySystem =
        (effectiveSystemPrompt || "") +
        "\n\nIMPORTANT: Tool execution is unavailable for this turn due to a provider validation issue. Answer the user's request directly in plain language. If the request is a simulation/projection (e.g. runway, what-if), produce a clear step-by-step plan and the formula or assumptions you would use, and ask for any missing inputs. Do NOT attempt to call any tools.";
      for (let i = 0; i < modelChain.length; i++) {
        const { name, model, maxChars } = modelChain[i];
        if (isRateLimited(name)) continue;
        try {
          console.log(`[Command API] Recovery (no-tools) trying: ${name}`);
          const modelBudgeted = buildBudgetedMessagesWithCap(budgeted.messages, maxChars);
          const result = streamText({
            ...(streamOptionsNoTools as object),
            system: recoverySystem,
            messages: modelBudgeted.messages,
            model,
            maxRetries: 0,
          } as Parameters<typeof streamText>[0]);
          const response = result.toUIMessageStreamResponse();
          if (response.body) {
            console.log(`[Command API] Recovery succeeded via ${name} (no tools).`);
            return response;
          }
        } catch (err) {
          console.warn(`[Command API] Recovery ${name} failed: ${(err as Error)?.message?.slice(0, 200)}`);
        }
      }
    }

    console.error("[Command API] All models failed. Last error:", lastError);
    throw lastError;
  } catch (error) {
    console.error("[Command API] Error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process command", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
