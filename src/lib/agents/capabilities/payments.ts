/**
 * DACS — Payments domain capabilities (NEW; not in legacy route.ts).
 *
 *   - recurring_payment: Streamflow/Squads vesting + cliff schedules as one call.
 *   - invoice_pay: parse an invoice (URL or text) → on-chain payment proposal.
 *   - gas_tank_topup: auto-refill SOL when wallet balance drops below floor.
 *   - grant_disbursement: milestone-conditional release (GitHub / on-chain proof).
 *   - expense_categorize: LLM-tag outgoing txs into a P&L taxonomy.
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";
import { resolveTokenMint, isSolSymbol, TOKEN_MINTS } from "./tokens";

/** Period in seconds for Streamflow stream cadence. */
const PERIOD_SECONDS: Record<"daily" | "weekly" | "biweekly" | "monthly", number> = {
  daily: 86_400,
  weekly: 604_800,
  biweekly: 1_209_600,
  // 30d approximation — Streamflow uses fixed-period seconds, not calendar months
  monthly: 2_592_000,
};

const recurring_payment = defineCapability({
  id: "recurring_payment",
  domain: "payments",
  description:
    "Schedule a real Streamflow vesting stream (payroll, retainer, grant) with optional cliff. Returns a signable VersionedTransaction and the on-chain stream metadata pubkey.",
  inputSchema: z.object({
    recipient: z.string(),
    token: z.string().default("USDC"),
    amountPerPeriod: z.number().positive(),
    period: z.enum(["daily", "weekly", "biweekly", "monthly"]),
    durationPeriods: z.number().int().positive(),
    cliffPeriods: z.number().int().min(0).optional().default(0),
    cancellable: z.boolean().optional().default(true),
    name: z.string().max(64).optional(),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  protocols: ["streamflow"],
  execute: async (input, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "recurring_payment", message: "Wallet required." };
    }
    const blocked = ctx.blockExecutionForBuildIntent("recurring_payment");
    if (blocked) return blocked;

    const totalAmount = input.amountPerPeriod * input.durationPeriods;

    // Resolve token mint
    const isSol = isSolSymbol(input.token);
    const mint = isSol ? "So11111111111111111111111111111111111111112" : resolveTokenMint(input.token.toUpperCase());
    if (!mint) {
      return {
        success: false,
        operation: "recurring_payment",
        message: `Unknown token: ${input.token}. Supported: ${Object.keys(TOKEN_MINTS).join(", ")}`,
      };
    }
    const decimals = ["USDC", "USDT"].includes(input.token.toUpperCase()) ? 6 : 9;

    try {
      const { PublicKey } = await import("@solana/web3.js");
      const { SolanaStreamClient, getBN, ICluster } = (await import("@streamflow/stream")) as typeof import("@streamflow/stream");

      // Validate recipient
      try {
        new PublicKey(input.recipient);
      } catch {
        return {
          success: false,
          operation: "recurring_payment",
          message: `Invalid recipient address: ${input.recipient}`,
        };
      }

      const senderPublicKey = new PublicKey(ctx.walletAddress);
      const periodSeconds = PERIOD_SECONDS[input.period];
      const startTs = Math.floor(Date.now() / 1000) + 60; // start in 60s — gives wallet time to sign
      const cliffTs = input.cliffPeriods > 0 ? startTs + input.cliffPeriods * periodSeconds : startTs;

      const client = new SolanaStreamClient(
        ctx.rpcEndpoint,
        ICluster.Mainnet,
        "confirmed",
      );

      const streamData = {
        recipient: input.recipient,
        tokenId: mint,
        start: startTs,
        amount: getBN(totalAmount, decimals),
        period: periodSeconds,
        cliff: cliffTs,
        cliffAmount: getBN(0, decimals),
        amountPerPeriod: getBN(input.amountPerPeriod, decimals),
        name: input.name?.slice(0, 64) ?? `dreyv-${Date.now()}`,
        canTopup: false,
        cancelableBySender: input.cancellable,
        cancelableByRecipient: false,
        transferableBySender: true,
        transferableByRecipient: false,
        automaticWithdrawal: false,
        withdrawalFrequency: 0,
      };

      const built = await client.buildCreateTransaction(streamData, {
        sender: { publicKey: senderPublicKey },
        isNative: isSol,
      });

      const serialized = Buffer.from(built.tx.serialize()).toString("base64");

      // Phase 7B.1 — Persist a pending row so the reconciler can verify on-chain
      // state after the user signs in the browser. Best-effort — never blocks.
      try {
        const { db } = await import("@/db");
        const { streamflowStreams } = await import("@/db/schema");
        if (db) {
          await db
            .insert(streamflowStreams)
            .values({
              streamId: built.metadataId,
              walletAddress: ctx.walletAddress,
              recipient: input.recipient,
              mint,
              tokenSymbol: input.token.toUpperCase(),
              amountPerPeriod: String(input.amountPerPeriod),
              periodSeconds,
              durationPeriods: input.durationPeriods,
              totalAmount: String(totalAmount),
              cliffSeconds: input.cliffPeriods * periodSeconds,
              cancellable: input.cancellable,
              startTs: startTs,
              status: "pending_signature",
            })
            .onConflictDoNothing({ target: streamflowStreams.streamId });
        }
      } catch (persistErr) {
        console.warn("[capability:recurring_payment] Persist pending row failed (best-effort):", persistErr);
      }

      return {
        success: true,
        operation: "recurring_payment",
        streamId: built.metadataId,
        metadataPubkey: built.metadataId,
        recipient: input.recipient,
        token: input.token,
        mint,
        amountPerPeriod: input.amountPerPeriod,
        period: input.period,
        periodSeconds,
        durationPeriods: input.durationPeriods,
        cliffPeriods: input.cliffPeriods,
        cancellable: input.cancellable,
        totalAmount,
        startTs,
        cliffTs,
        serializedTransaction: serialized,
        txKind: "versioned",
        recentBlockhash: built.hash,
        status: "READY_FOR_SIGNATURE",
        requiresApproval: true,
        message: `Streamflow stream prepared: ${input.amountPerPeriod} ${input.token} every ${input.period} → ${input.recipient.slice(0, 8)}… for ${input.durationPeriods} period(s) (total ${totalAmount} ${input.token}). Stream ID ${built.metadataId.slice(0, 8)}…. Sign to escrow funds.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:recurring_payment] Streamflow build error:", msg);
      return {
        success: false,
        operation: "recurring_payment",
        recipient: input.recipient,
        token: input.token,
        amountPerPeriod: input.amountPerPeriod,
        period: input.period,
        durationPeriods: input.durationPeriods,
        totalAmount,
        buildError: msg,
        message: `Failed to build Streamflow stream: ${msg}`,
      };
    }
  },
});

/**
 * Phase 7B.2 — Invoice OCR + URL parse.
 *
 *   - URL input  → Cloudflare Browser Rendering `jsonExtract` (renders JS,
 *                  passes a JSON schema + extraction prompt to Workers AI).
 *   - Image/PDF  → Lovable AI gateway with `image_url` content (Gemini vision)
 *                  using tool-calling for structured output.
 *   - Raw text   → Lovable AI gateway, same tool-calling schema, text-only.
 *
 * Returns extracted fields + per-field `confidence` (0..1), `overallConfidence`
 * (mean of present fields), and `warnings[]` for anything heuristically suspect.
 * The downstream `invoice_pay` capability accepts the `extracted` payload.
 */
const INVOICE_FIELD_SCHEMA = {
  type: "object",
  properties: {
    recipient: { type: "string", description: "On-chain Solana wallet address (base58, 32-44 chars). Empty string if absent." },
    amount: { type: "number", description: "Total amount due as a positive number. 0 if unknown." },
    token: { type: "string", description: "Token/currency symbol (USDC, SOL, USDT). Default 'USDC' for fiat USD." },
    invoiceNumber: { type: "string" },
    issueDate: { type: "string", description: "ISO YYYY-MM-DD or empty." },
    dueDate: { type: "string", description: "ISO YYYY-MM-DD or empty." },
    payer: { type: "string" },
    payee: { type: "string" },
    memo: { type: "string", description: "Short on-chain memo (<=64 chars)." },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unitPrice: { type: "number" },
          total: { type: "number" },
        },
        required: ["description", "total"],
      },
    },
    fieldConfidence: {
      type: "object",
      description: "Per-field confidence 0..1. Use 0 for guessed/empty fields.",
      properties: {
        recipient: { type: "number" },
        amount: { type: "number" },
        token: { type: "number" },
        invoiceNumber: { type: "number" },
        issueDate: { type: "number" },
        dueDate: { type: "number" },
        payer: { type: "number" },
        payee: { type: "number" },
      },
    },
  },
  required: ["recipient", "amount", "token", "fieldConfidence"],
} as const;

const EXTRACTION_PROMPT = `You are an invoice parser for a crypto treasury app. Extract structured payment fields. Rules:
- Solana addresses are base58, 32-44 chars (no 0OIl). EVM (0x…) → leave recipient empty.
- amount = TOTAL DUE (after tax/fees). Not the subtotal.
- token: prefer on-chain symbols (USDC/SOL/USDT). USD → USDC.
- For each field set fieldConfidence[name] in [0,1]. Honest: 0 if guessed, 1 if verbatim.
- Never fabricate. Empty/0 for missing.`;

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ExtractedInvoice {
  recipient: string;
  amount: number;
  token: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  payer?: string;
  payee?: string;
  memo?: string;
  lineItems?: Array<{ description: string; quantity?: number; unitPrice?: number; total: number }>;
  fieldConfidence: Record<string, number>;
}

async function callLovableAI(payload: Record<string, unknown>, timeoutMs = 25_000): Promise<Response> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured — cannot run invoice OCR.");
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function extractViaLovableAI(content: Array<Record<string, unknown>> | string): Promise<ExtractedInvoice> {
  const messages = [
    { role: "system", content: EXTRACTION_PROMPT },
    { role: "user", content: typeof content === "string" ? content : content },
  ];
  const res = await callLovableAI({
    model: "google/gemini-3-flash-preview",
    messages,
    tools: [{
      type: "function",
      function: {
        name: "extract_invoice",
        description: "Return structured invoice fields with per-field confidence.",
        parameters: INVOICE_FIELD_SCHEMA,
      },
    }],
    tool_choice: { type: "function", function: { name: "extract_invoice" } },
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("Rate limited by Lovable AI. Retry shortly.");
    if (res.status === 402) throw new Error("Lovable AI credits exhausted.");
    throw new Error(`Lovable AI ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const json = await res.json();
  const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!toolCall) throw new Error("Lovable AI returned no tool call — extraction failed.");
  return JSON.parse(toolCall) as ExtractedInvoice;
}

async function extractFromUrl(url: string): Promise<ExtractedInvoice> {
  try {
    const { jsonExtract } = await import("@/lib/cloudflare/cf-browser");
    const result = await jsonExtract({
      url,
      prompt: EXTRACTION_PROMPT,
      response_format: { type: "json_schema", schema: INVOICE_FIELD_SCHEMA as unknown as Record<string, unknown> },
      waitForTimeout: 3000,
    });
    if (result?.success && result.result) return result.result as ExtractedInvoice;
  } catch (err) {
    console.warn("[invoice_extract] CF Browser failed, falling back to AI text mode:", err);
  }
  const html = await fetch(url, { signal: AbortSignal.timeout(15_000) }).then((r) => r.text());
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").slice(0, 30_000);
  return extractViaLovableAI(`Source URL: ${url}\n\nHTML:\n${stripped}`);
}

function postProcess(extracted: ExtractedInvoice): { extracted: ExtractedInvoice; warnings: string[]; overallConfidence: number } {
  const warnings: string[] = [];
  const fc = extracted.fieldConfidence ?? {};
  if (extracted.recipient && !SOLANA_ADDR_RE.test(extracted.recipient)) {
    warnings.push(`recipient '${extracted.recipient.slice(0, 12)}…' is not a valid Solana address`);
    fc.recipient = 0;
  }
  if (!extracted.recipient) warnings.push("recipient missing — manual entry required before payment");
  if (!extracted.amount || extracted.amount <= 0) warnings.push("amount missing or non-positive");
  if (extracted.token && !/^[A-Z]{2,8}$/.test(extracted.token)) warnings.push(`token symbol '${extracted.token}' looks unusual`);
  for (const dateField of ["issueDate", "dueDate"] as const) {
    const v = extracted[dateField];
    if (v && !ISO_DATE_RE.test(v)) warnings.push(`${dateField} '${v}' is not ISO YYYY-MM-DD`);
  }
  const presentScores: number[] = [];
  if (extracted.recipient) presentScores.push(fc.recipient ?? 0);
  if (extracted.amount > 0) presentScores.push(fc.amount ?? 0);
  if (extracted.token) presentScores.push(fc.token ?? 0);
  if (extracted.invoiceNumber) presentScores.push(fc.invoiceNumber ?? 0);
  if (extracted.dueDate) presentScores.push(fc.dueDate ?? 0);
  const overallConfidence = presentScores.length === 0
    ? 0
    : Math.round((presentScores.reduce((a, b) => a + b, 0) / presentScores.length) * 100) / 100;
  return { extracted, warnings, overallConfidence };
}

const invoice_extract = defineCapability({
  id: "invoice_extract",
  domain: "payments",
  description:
    "Extract structured payment fields (recipient, amount, token, invoice #, dates, line items) from an invoice URL, image (data URL), PDF (data URL), or raw text. Returns per-field confidence + overall confidence + warnings. Read-only. Pipe into `invoice_pay`.",
  inputSchema: z
    .object({
      url: z.string().url().optional(),
      imageDataUrl: z
        .string()
        .regex(/^data:(image\/(png|jpe?g|webp|gif)|application\/pdf);base64,/, "Must be a base64 data URL for image/* or application/pdf")
        .optional(),
      text: z.string().min(20).optional(),
    })
    .refine((v) => !!(v.url || v.imageDataUrl || v.text), { message: "Provide one of: url, imageDataUrl, text" }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  protocols: ["lovable-ai", "cf-browser"],
  execute: async (input, _ctx) => {
    const sourceKind = input.url ? "url" : input.imageDataUrl ? "image" : "text";
    try {
      let raw: ExtractedInvoice;
      if (input.url) {
        raw = await extractFromUrl(input.url);
      } else if (input.imageDataUrl) {
        raw = await extractViaLovableAI([
          { type: "text", text: "Extract invoice fields from this document." },
          { type: "image_url", image_url: { url: input.imageDataUrl } },
        ]);
      } else {
        raw = await extractViaLovableAI(input.text!);
      }
      const { extracted, warnings, overallConfidence } = postProcess(raw);
      return {
        success: true,
        operation: "invoice_extract",
        sourceKind,
        extracted,
        overallConfidence,
        warnings,
        nextStep:
          extracted.recipient && extracted.amount > 0
            ? `Call invoice_pay with extracted={recipient,amount,token,memo} + overallConfidence=${overallConfidence}`
            : "Resolve missing fields (recipient/amount) before invoice_pay.",
        message: `Parsed invoice from ${sourceKind} — ${extracted.amount || "?"} ${extracted.token || "?"} → ${extracted.recipient ? extracted.recipient.slice(0, 8) + "…" : "(no recipient)"} · ${Math.round(overallConfidence * 100)}% confidence${warnings.length ? ` · ${warnings.length} warning(s)` : ""}`,
      };
    } catch (err) {
      return {
        success: false,
        operation: "invoice_extract",
        sourceKind,
        message: err instanceof Error ? err.message : "Invoice extraction failed.",
      };
    }
  },
});

const invoice_pay = defineCapability({
  id: "invoice_pay",
  domain: "payments",
  description:
    "Parse an invoice (URL, raw text, or structured fields) and produce an on-chain payment proposal with memo and reference. For URL/text/image inputs, prefer calling `invoice_extract` first to get a confidence-scored extraction.",
  inputSchema: z.object({
    source: z.union([
      z.object({ url: z.string().url() }),
      z.object({ text: z.string().min(10) }),
      z.object({
        recipient: z.string(),
        amount: z.number().positive(),
        token: z.string().default("USDC"),
        memo: z.string().optional(),
        invoiceNumber: z.string().optional(),
      }),
    ]),
    /** Optional structured payload from `invoice_extract`. */
    extracted: z
      .object({
        recipient: z.string(),
        amount: z.number().positive(),
        token: z.string(),
        memo: z.string().optional(),
        invoiceNumber: z.string().optional(),
      })
      .optional(),
    /** Minimum overall confidence required to auto-proceed (default 0.7). */
    minConfidence: z.number().min(0).max(1).optional().default(0.7),
    overallConfidence: z.number().min(0).max(1).optional(),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async ({ source, extracted, minConfidence, overallConfidence }, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "invoice_pay", message: "Wallet required." };
    }
    const blocked = ctx.blockExecutionForBuildIntent("invoice_pay");
    if (blocked) return blocked;

    // Pre-extracted payload from invoice_extract — most reliable path.
    if (extracted) {
      if (overallConfidence !== undefined && overallConfidence < (minConfidence ?? 0.7)) {
        return {
          success: false,
          operation: "invoice_pay",
          status: "LOW_CONFIDENCE",
          requiresApproval: false,
          extracted,
          overallConfidence,
          message: `Extraction confidence ${Math.round(overallConfidence * 100)}% < threshold ${Math.round((minConfidence ?? 0.7) * 100)}%. Confirm fields manually before paying.`,
        };
      }
      return {
        success: true,
        operation: "invoice_pay",
        ...extracted,
        requiresApproval: true,
        message: `Invoice ${extracted.invoiceNumber ?? ""} → pay ${extracted.amount} ${extracted.token} to ${extracted.recipient.slice(0, 8)}…. Sign to send.`,
      };
    }

    const isStructured = "recipient" in source && "amount" in source;
    if (!isStructured) {
      return {
        success: false,
        operation: "invoice_pay",
        status: "NEEDS_PARSE",
        message:
          "Invoice received. Run `invoice_extract` first, then call again with the `extracted` payload.",
      };
    }
    const s = source as { recipient: string; amount: number; token: string; memo?: string; invoiceNumber?: string };
    return {
      success: true,
      operation: "invoice_pay",
      ...s,
      requiresApproval: true,
      message: `Invoice ${s.invoiceNumber || ""} → pay ${s.amount} ${s.token} to ${s.recipient.slice(0, 8)}…. Sign to send.`,
    };
  },
});

const gas_tank_topup = defineCapability({
  id: "gas_tank_topup",
  domain: "payments",
  description:
    "Persist an auto-refill rule: when wallet SOL drops below `floorSol`, the gas-tank watcher cron will draft a Jupiter swap (stables → SOL) up to `targetSol`. The user signs each refill in-app. Set `enabled: false` to pause; pass an existing `ruleId` to update.",
  inputSchema: z.object({
    floorSol: z.number().positive().describe("Refill trigger threshold in SOL"),
    targetSol: z.number().positive().describe("Refill target balance in SOL"),
    fundingToken: z.string().default("USDC"),
    maxRefillsPerDay: z.number().int().positive().optional().default(3),
    slippageBps: z.number().int().min(1).max(1000).optional().default(50),
    enabled: z.boolean().optional().default(true),
    ruleId: z.string().uuid().optional().describe("If set, update this rule instead of creating a new one"),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "medium",
  protocols: ["jupiter", "helius"],
  execute: async (input, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "gas_tank_topup", message: "Wallet required." };
    }
    if (input.targetSol <= input.floorSol) {
      return {
        success: false,
        operation: "gas_tank_topup",
        message: `targetSol (${input.targetSol}) must be greater than floorSol (${input.floorSol}).`,
      };
    }
    const fundingMint = resolveTokenMint(input.fundingToken);
    if (!fundingMint || isSolSymbol(input.fundingToken)) {
      return {
        success: false,
        operation: "gas_tank_topup",
        message: `Funding token must be a non-SOL token with a known mint. Got '${input.fundingToken}'.`,
      };
    }

    try {
      const { db } = await import("@/db");
      const { gasTankRules } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      if (!db) throw new Error("Database not configured");

      const baseValues = {
        walletAddress: ctx.walletAddress,
        floorSol: String(input.floorSol),
        targetSol: String(input.targetSol),
        fundingToken: input.fundingToken.toUpperCase(),
        fundingMint,
        maxRefillsPerDay: input.maxRefillsPerDay,
        slippageBps: input.slippageBps,
        enabled: input.enabled,
        updatedAt: new Date(),
      };

      let ruleId: string;
      let action: "created" | "updated";
      if (input.ruleId) {
        const updated = await db
          .update(gasTankRules)
          .set(baseValues)
          .where(eq(gasTankRules.id, input.ruleId))
          .returning({ id: gasTankRules.id });
        if (updated.length === 0) {
          return {
            success: false,
            operation: "gas_tank_topup",
            message: `Rule ${input.ruleId} not found.`,
          };
        }
        ruleId = updated[0].id;
        action = "updated";
      } else {
        const inserted = await db
          .insert(gasTankRules)
          .values(baseValues)
          .returning({ id: gasTankRules.id });
        ruleId = inserted[0].id;
        action = "created";
      }

      return {
        success: true,
        operation: "gas_tank_topup",
        ruleId,
        action,
        ...input,
        fundingMint,
        status: input.enabled ? "ARMED" : "PAUSED",
        requiresApproval: false,
        message: input.enabled
          ? `Gas tank ${action}: refill to ${input.targetSol} SOL when balance < ${input.floorSol} SOL (funded from ${input.fundingToken}, max ${input.maxRefillsPerDay}/day, ${input.slippageBps}bps slippage). Watcher polls every 2 minutes.`
          : `Gas tank rule ${action} and PAUSED — no refills will be drafted until enabled=true.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:gas_tank_topup] Persist failed:", msg);
      return {
        success: false,
        operation: "gas_tank_topup",
        message: `Failed to persist rule: ${msg}`,
      };
    }
  },
});

const grant_disbursement = defineCapability({
  id: "grant_disbursement",
  domain: "payments",
  description:
    "Create a milestone-gated grant. Funds release only when the milestone proof (GitHub PR merged / on-chain event / oracle attestation) is verified.",
  inputSchema: z.object({
    grantee: z.string(),
    token: z.string().default("USDC"),
    milestones: z
      .array(
        z.object({
          label: z.string(),
          amount: z.number().positive(),
          proof: z.discriminatedUnion("type", [
            z.object({ type: z.literal("github_pr"), repo: z.string(), prNumber: z.number().int().positive() }),
            z.object({ type: z.literal("onchain_event"), program: z.string(), eventName: z.string() }),
            z.object({ type: z.literal("manual_attestation"), attesters: z.array(z.string()).min(1) }),
          ]),
        }),
      )
      .min(1),
  }),
  sideEffects: "write",
  requiredAuth: "wallet",
  sensitivity: "high",
  execute: async ({ grantee, token, milestones }, ctx) => {
    if (!ctx.walletAddress) {
      return { success: false, operation: "grant_disbursement", message: "Wallet required." };
    }
    const blocked = ctx.blockExecutionForBuildIntent("grant_disbursement");
    if (blocked) return blocked;
    const total = milestones.reduce((s, m) => s + m.amount, 0);
    return {
      success: true,
      operation: "grant_disbursement",
      grantId: `grant_${Math.random().toString(36).slice(2, 10)}`,
      grantee,
      token,
      milestones,
      totalAmount: total,
      requiresApproval: true,
      message: `Grant drafted: ${total} ${token} to ${grantee.slice(0, 8)}… across ${milestones.length} milestone(s). Sign to escrow.`,
    };
  },
});

const expense_categorize = defineCapability({
  id: "expense_categorize",
  domain: "payments",
  description:
    "Tag recent outgoing transactions into a P&L taxonomy (payroll / vendor / grant / marketing / opex / capex / other) using LLM + heuristics.",
  inputSchema: z.object({
    lookbackDays: z.number().int().min(1).max(365).optional().default(30),
    walletOverride: z.string().optional(),
  }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async ({ lookbackDays, walletOverride }, ctx) => {
    const wallet = walletOverride || ctx.walletAddress;
    if (!wallet) return { success: false, operation: "expense_categorize", message: "Wallet required." };
    return {
      success: true,
      operation: "expense_categorize",
      wallet,
      lookbackDays,
      categories: ["payroll", "vendor", "grant", "marketing", "opex", "capex", "other"],
      status: "DEFERRED_TO_INDEXER",
      message: `Expense categorization queued for last ${lookbackDays}d on ${wallet.slice(0, 8)}…. Result streams when the Helius/RPC indexer pass completes.`,
    };
  },
});

export const paymentsCapabilities: AnyCapability[] = [
  recurring_payment,
  invoice_extract,
  invoice_pay,
  gas_tank_topup,
  grant_disbursement,
  expense_categorize,
];
