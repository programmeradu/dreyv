import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { estimateCompatibilityBudget } from "@/lib/llm/model-compatibility";
import { buildLegacyTools, buildCapabilityContext } from "@/lib/agents/capabilities/legacy-shim";
import { buildCommandBarSystemPrompt, STRICT_GROUNDING_ADDENDUM } from "@/lib/agents/commandbar/system-prompt";
import { stripHallucinatedToolEnvelopes } from "@/lib/agents/commandbar/scrub-tool-envelopes";
import { summarizeYieldForLLM, fetchLiveLstRates } from "@/lib/foresight/lst-yield";
import { summarizeYieldRoutesForLLM } from "@/lib/agents/capabilities/yield-routes";
import {
  summarizePendingProposals,
  summarizeActiveAlerts,
  summarizeActivePolicy,
  summarizeRecentActions,
} from "@/lib/agents/capabilities/app-control";

export const runtime = "edge";

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
    // Tier from authenticated session — gates Mini/Max-only capabilities at tool-call time.
    const userTier = ((authUser.tier as string) === "mini" || (authUser.tier as string) === "max"
      ? (authUser.tier as "mini" | "max")
      : "free");
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
      vaultAddress: vaultAddress || null,
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
    const registryTools = buildLegacyTools(capabilityCtx, { userTier });

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
      return /tool call validation failed|was not in request\.tools|invalid_request_error|function definitions do not fully cover|Please adjust your prompt|Please enhance them|failed_generation/i.test(msg);
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
        const result = streamText({ ...streamOptions, messages: modelBudgeted.messages, model, maxRetries: 1 });

        // The AI SDK throws provider errors (e.g. 429) asynchronously.
        // The error surfaces on result.response promise, NOT on reader.read().
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

        // Race: substantive-content vs provider error vs hard timeout.
        // Keep buffering chunks until we see actual content (`text-delta` /
        // `tool-output-available` / `finish` / `error`) — NOT just any chunk.
        // A bare `start` / `text-start` / `tool-input-start` does not prove
        // the provider will produce useful output; Groq's tool-call validation
        // failures arrive AFTER those events, so we used to silently commit
        // to a doomed stream. Now we keep reading (with a 6s budget) until
        // we have proof of substance.
        type RaceOutcome =
          | { type: "ready"; buffered: Uint8Array[]; done: boolean }
          | { type: "error"; error: unknown }
          | { type: "timeout"; buffered: Uint8Array[] };

        const buffered: Uint8Array[] = [];
        const decoder = new TextDecoder("utf-8", { fatal: false });
        let bufferedText = "";

        const SUBSTANTIVE = /"type":"(text-delta|tool-output-available|tool-input-available|finish|finish-step)"/;
        const STREAM_ERROR = /"type":"error"|"errorText"|invalid_request_error|failed_generation|Failed to call a function|tool call validation failed|function definitions do not fully cover|Please adjust your prompt|Please enhance them/i;

        const errorPromise: Promise<RaceOutcome> = Promise.resolve(result.response).then(
          () => new Promise<RaceOutcome>(() => {}), // success: stay pending
          (e: unknown) => ({ type: "error" as const, error: e }),
        );
        const timeoutPromise: Promise<RaceOutcome> = new Promise((resolve) =>
          setTimeout(() => resolve({ type: "timeout", buffered }), 15_000),
        );

        const readUntilSubstantive: Promise<RaceOutcome> = (async () => {
          const start = Date.now();
          while (Date.now() - start < 6000) {
            const { value, done } = await reader.read();
            if (done) return { type: "ready", buffered, done: true };
            if (value) {
              buffered.push(value);
              bufferedText += decoder.decode(value, { stream: true });
              if (STREAM_ERROR.test(bufferedText)) {
                throw new Error(`Provider stream error from ${name}: ${bufferedText.slice(0, 400)}`);
              }
              if (SUBSTANTIVE.test(bufferedText)) {
                return { type: "ready", buffered, done: false };
              }
            }
          }
          // 6s elapsed but no substantive content seen → keep what we have and proceed.
          return { type: "ready", buffered, done: false };
        })();

        const raceResult = await Promise.race([readUntilSubstantive, errorPromise, timeoutPromise]);

        if (raceResult.type === "error") {
          try { reader.releaseLock(); } catch { /* ignore */ }
          throw (raceResult as { error: unknown }).error;
        }
        if (raceResult.type === "timeout") {
          try { reader.releaseLock(); } catch { /* ignore */ }
          throw new Error(`Provider ${name} did not produce substantive content within 15s`);
        }

        // Provider is confirmed working — re-assemble the stream, replaying
        // buffered chunks then forwarding the rest. Mid-stream errors now
        // call controller.error() so the client sees an explicit failure
        // (and useChat triggers onError) instead of a silent close.
        const finalStream = new ReadableStream({
          start(controller) {
            for (const chunk of raceResult.buffered) controller.enqueue(chunk);
            if (raceResult.done) {
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
                controller.close();
              } catch (streamErr) {
                console.warn(
                  `[Command API] Mid-stream error from ${name}:`,
                  streamErr instanceof Error ? streamErr.message.slice(0, 220) : String(streamErr),
                );
                try { controller.error(streamErr); } catch { /* ignore */ }
              } finally {
                try { reader.releaseLock(); } catch { /* ignore */ }
              }
            })();
          },
        });

        if (name !== "groq/llama-3.3-70b-versatile") {
          console.log(`[Command API] Using fallback model: ${name}`);
        }
        return new Response(stripHallucinatedToolEnvelopes(finalStream), {
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
    // GOD-MODE: trigger the no-tools recovery whenever every provider failed
    // for ANY reason — not just tool-call validation. Better to ship a useful
    // clarifying chat reply than to surface a 500 to the user.
    if (anyAttemptMade && lastError) {
      const recoveryReason = allFailuresWereToolValidation ? "tool-call validation" : "all providers failed";
      console.warn(`[Command API] Entering no-tools recovery (${recoveryReason}).`);
      const { tools: _droppedTools, toolChoice: _droppedToolChoice, ...streamOptionsNoTools } =
        streamOptions as Record<string, unknown>;
      void _droppedTools;
      void _droppedToolChoice;
      const recoverySystem =
        (effectiveSystemPrompt || "") +
        `\n\nIMPORTANT: Tool execution is unavailable for this turn. Your job is to UNBLOCK the user, not apologize.\n\n` +
        `Respond in this exact shape:\n` +
        `1. One short sentence acknowledging what you understood from the user's request (no apology, no mention of "tool" or "error").\n` +
        `2. One concrete clarifying question that, once answered, lets the action proceed (e.g. which token, which source wallet, which amount, which destination).\n` +
        `3. 2-4 suggestion chips the user can click to re-send. Each chip MUST be on its own line and start with "→ " followed by a complete, self-contained command the user could send verbatim. Keep each chip under 80 chars. No trailing punctuation.\n\n` +
        `Example:\n` +
        `Got it — you want to deposit into the treasury. Which token and how much?\n` +
        `→ deposit 0.05 SOL into the treasury\n` +
        `→ deposit 10 USDC into the treasury from my main wallet\n` +
        `→ show treasury balance first\n\n` +
        `Do NOT attempt to call tools. Do NOT mention providers, models, or validation errors.`;
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
            return new Response(stripHallucinatedToolEnvelopes(response.body), {
              headers: response.headers,
              status: response.status,
            });
          }
        } catch (err) {
          console.warn(`[Command API] Recovery ${name} failed: ${(err as Error)?.message?.slice(0, 200)}`);
        }
      }
    }

    console.error("[Command API] All models failed. Last error:", lastError);
    // Final fallback: synthesize a UI-message SSE stream so the CommandBar
    // always renders SOMETHING actionable instead of a silent failure.
    const friendly =
      "I caught that mid-stream and want to make sure I get it right. Could you give me one more detail, or pick a suggestion below?\n\n→ Show me today's treasury snapshot\n→ Find DCA opportunities for SOL right now\n→ Run a risk scan on my wallet\n→ Suggest a rebalance for medium risk";
    const encoder = new TextEncoder();
    const fallbackStream = new ReadableStream({
      start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        const id = `msg-${Date.now()}`;
        send({ type: "start", messageId: id });
        send({ type: "text-start", id });
        send({ type: "text-delta", id, delta: friendly });
        send({ type: "text-end", id });
        send({ type: "finish" });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(fallbackStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "x-vercel-ai-ui-message-stream": "v1",
      },
    });
  } catch (error) {
    console.error("[Command API] Error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process command", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
