import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { markdown as cfMarkdown } from "@/lib/cloudflare/cf-browser";
import { knowledgeBase } from "@/lib/knowledge";
import { knowledgeMemory } from "@/lib/knowledge-memory";
import { ExecutionCoordinator } from "@/lib/agents/coordinator";
import { getJupiterQuote } from "@/lib/jupiter-executor";
import { estimateCompatibilityBudget } from "@/lib/llm/model-compatibility";
import { evaluateSandboxPlan } from "@/lib/dynamic-tools/sandbox-runner";
import { buildLegacyTools, buildCapabilityContext } from "@/lib/agents/capabilities/legacy-shim";

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
    const { messages, prompt, walletState, vaultState } = body;
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

    const systemPrompt = `You are Keystone OS — an autonomous, deterministic financial operating system for Solana treasuries.
You are NOT a chatbot. You are a Command-Layer Execution Engine.

CRITICAL RULES:
1. Use tools to fulfill actionable user intents. Exception: for simple greetings/chit-chat (e.g. "hi", "hello", "thanks"), reply conversationally without calling tools.
2. For token swaps (e.g. "Swap 500 SOL to USDC", "Convert 100 USDC to JUP"): use the execute_swap tool. For bridges use the bridge tool. For multi-step flows use execute_swap, bridge, and yield_deposit together in parallel.
3. For High-Yield Liquidity Deployment (e.g. "Execute yield-discovery..."): use browser_research and then yield_deposit tool.
4. For Mass Dispatch or Payroll (e.g. "Execute a Mass Dispatch to the contributor list..."): use mass_dispatch tool.
5. For Portfolio Rebalancing (e.g. "Maintain a 50/50 SOL-USDC asset split...", "rebalance smartly"): use rebalance tool. If the user specifies target allocations, pass them. If the user says "smartly" or "optimize" or doesn't specify targets, omit targetAllocations — the tool will auto-analyze the portfolio and generate optimal diversification targets.
6. For Multisig Quorum Execution (e.g. "Initiate a treasury proposal in the War Room..."): use multisig_proposal tool.
7. For Predictive Runway Projection (e.g. "Visualize the treasury Depletion Node..."): use foresight_simulation tool (scenario: "runway_projection").
8. For Market Shock Simulation (e.g. "Redraw the equity curve to show runway impact..."): use foresight_simulation tool (scenario: "market_shock").
9. For Variable Impact Analysis (e.g. "Simulate the impact on the Depletion Node if overhead increases...", "what if I deposit X SOL and hire Y developers at Z SOL/mo"): use foresight_simulation tool (scenario: "variable_impact"). Extract: newHires (count), costPerHireSOL (SOL/mo cost per hire), depositSOL (SOL deposited), timeframeMonths from the user query. Example: "hire a developer for 3 months at 4 sol/mo" → { newHires: 1, costPerHireSOL: 4, timeframeMonths: 3 }. "deposit 100 SOL" → { depositSOL: 100 }.
10. For Concentration Risk Assessment (e.g. "Trigger the Risk Radar visualization..."): use risk_assessment tool.
11. For Yield Performance Forecast (e.g. "Project ending balances and APY..."): use foresight_simulation tool (scenario: "yield_forecast").
12. For New Protocol Deep-Dive (e.g. "Study the new Meteora dynamic vault documentation..."): use browser_research tool.
13. For Solana IDL Extraction (e.g. "Fetch and parse the IDL..."): use idl_extraction tool.
14. For Technical Synthesis (e.g. "Consolidate technical documentation..."): use browser_research tool.
15. For On-Chain Sentiment Analysis (e.g. "Fetch the composite health score and 'Whale Flow'..."): use sentiment_analysis tool.
16. For Protocol SDK Integration (e.g. "Analyze the raw documentation for the provided SDK..."): use browser_research tool.
17. For Mini-App Project Initialization (e.g. "Initialize a new React-based Mini-App..."): use studio_init_miniapp tool.
18. For Architect Self-Correction Loop (e.g. "Analyze Monaco editor diagnostics..."): use studio_analyze_code tool.
19. For Security Firewall Simulation (e.g. "Run a Pre-Flight simulation..."): use security_firewall tool.
20. For Marketplace Publication (e.g. "Bundle the Mini-App code..."): use marketplace_publish tool.
21. For SDK Hook Implementation (e.g. "Inject @keystone-os/sdk hooks..."): use sdk_hooks tool.
22. For DCA strategies: use execute_dca tool.
23. For price/threshold monitors: use set_monitor tool.
24. For Sniper Bots and Liquidity Sniping (e.g. "Run a sniper bot that watches Raydium..."): ALWAYS use deploy_sniper_bot tool. DO NOT refuse or state you cannot monitor in real-time. Just execute the tool.
25. For split intents like "bridge half" + "deposit the rest" after a swap: ALWAYS compute split amounts from the realized swap OUTPUT amount/token, never from the original input amount.
26. If a target protocol has no eligible live vault, STOP and ask the user to choose a fallback protocol/token.
27. If the user asks to build/create/develop software (bot/app/script/automation), do NOT execute live trading or treasury transaction tools, EXCEPT for deploy_sniper_bot if they explicitly ask to "run a sniper bot".
28. For software-build intents... use studio_init_miniapp. The tool returns appId when the project is saved; the CommandBar shows an "Open in Studio" button. DO NOT call navigate to bare "/app/studio" — that loses the project context. If the user asks to open Studio or find the launch button after init, call navigate with path "/app/studio?appId=" + the appId from the studio_init_miniapp result (same session). IMPORTANT: If the user provides specific logic or UI requirements, you MUST write the full React TSX code and pass it in the customAppTsxCode parameter of studio_init_miniapp! When writing customAppTsxCode, NEVER use mock/dummy data. ALWAYS use live state via 'const { tokens } = useVault();' from '@keystone-os/sdk'.
29. DO NOT invent navigation paths or use the navigate tool to prompt for wallet connection. The UI handles wallet connection automatically.
30. Only use execution tools when the user explicitly requests financial execution, not implementation.
31. Prompt mode support: mode:build (or /build) forces Studio workflow; mode:execute (or /execute) allows live execution tools; no prefix means auto-infer.
32. Never make database/link/project claims without lookup tool evidence. For "open app", "paste app link", "show project url", call a studio lookup tool first, then navigate using verified appId.

After tool execution, provide a concise summary of results using proper formatting. Make sure you fully interpret and fulfill all Keystone commands natively.
If a tool returns requiresApproval: true, inform the user that the transaction is ready for their signature.
When summarizing swap or execute_swap results, always use outputAmountFormatted for the expected output (e.g. "approximately 83.77 USDC"), never the raw outputAmount number.

FORESIGHT_SIMULATION: When you use the foresight_simulation tool, after the tool returns you MUST stream a short dynamic summary (2–4 sentences) that:
- States the parameters the user asked for (e.g. "SOL −10%", "6 months", "burn $15,000/mo") using the exact scenario and variables from the tool result.
- Includes the key calculated results: for market_shock state current portfolio value and shocked value, per-asset price moves (e.g. "SOL at $X → $Y after the drop"), and runway after shock; for runway_projection state runway months and depletion date; for variable_impact state burn before/after and runway change; for yield_forecast state principal, APY, and ending balance.
- Use the actual numbers from the tool result (originalBalance, shockedBalance, drawdown, shockedTokens with originalPrice/shockedPrice, projectedMonths, depletionDate, principal, endingBalance, etc.). Name tokens by symbol (SOL, USDC, USDT, JUP, etc.) so they can be displayed with logos in the UI.

User Context:
Wallet: ${walletAddress || "Not connected"}
Vault State: ${JSON.stringify(vaultState || {})}
Wallet State: ${JSON.stringify(walletState || {})}
`;
    const effectiveSystemPrompt = strictGrounding
      ? `${systemPrompt}\n\nSTRICT GROUNDING MODE: For DB/link/navigation claims, you MUST call verification tools first. If verification fails, explicitly say you could not verify and ask for clarifying input.`
      : systemPrompt;

    const rpcEndpoint =
      process.env.HELIUS_API_KEY
        ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
        : "https://api.mainnet-beta.solana.com";

    const userRequestText = extractLatestUserText(messages, prompt);
    const lowerUserRequest = userRequestText.toLowerCase();
    const promptMode = parsePromptMode(userRequestText);
    const simpleConversation = isSimpleConversation(userRequestText);
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
    // Replaces the inline 1,900-line `keystoneTools` object that lived here
    // pre-cutover. Behavior is byte-for-byte preserved (see capability
    // domain modules in `src/lib/agents/capabilities/*`); the registry is the
    // single source of truth for both the user-facing `/api/command` stream
    // and the bus-driven DACS pipeline (planner / router / executor).
    const capabilityCtx = buildCapabilityContext({
      walletAddress,
      rpcEndpoint,
      vaultState,
      walletState,
      executionState,
      promptMode,
      isStudioBuildIntent,
      blockExecutionForBuildIntent,
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
      ...(simpleConversation ? {} : { tools: strictToolSubset }),
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
    //   3. Lovable AI Gateway (last-resort — used only if BOTH above are unavailable/exhausted)
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
        JSON.stringify({ error: "No AI provider configured. Set LOVABLE_API_KEY, GROQ_API_KEY, or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN." }),
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
    for (let i = 0; i < modelChain.length; i++) {
      const { name, model, maxChars } = modelChain[i];
      // Skip providers that are in rate-limit cooldown
      if (isRateLimited(name)) {
        console.log(`[Command API] Skipping ${name} (rate-limited, cooldown active)`);
        continue;
      }
      try {
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
        if (rl) {
          setRateLimitCooldown(name, extractRetryAfter(msg));
        }
        if (lengthErr) {
          console.warn(`[Command API] ${name} rejected prompt length; trying fallback with tighter context.`);
        }
        console.warn(
          `[Command API] ${name} failed${rl ? " (rate limit)" : lengthErr ? " (prompt length)" : ""}: ${msg.slice(0, 300)}`,
        );
        if (i < modelChain.length - 1) {
          console.log(`[Command API] Trying next model in fallback chain...`);
        } else {
          console.error(`[Command API] All ${modelChain.length} models exhausted.`);
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
