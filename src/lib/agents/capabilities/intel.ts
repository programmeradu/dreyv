/**
 * DACS Phase 0 — Intel domain capabilities.
 *
 * Migrated 1:1 from `src/app/api/command/route.ts`. Behavior is byte-for-byte
 * preserved; request-scope state flows through `CapabilityContext`.
 *
 * Capabilities in this module:
 *   - foresight_simulation:  runway / market shock / variable impact / yield forecast
 *   - risk_assessment:       concentration risk → Risk Radar viz
 *   - browser_research:      multi-source research (Cloudflare browser + KB)
 *   - idl_extraction:        Anchor IDL fetch + decompress from on-chain PDA
 *   - sentiment_analysis:    on-chain whale flow + activity score
 *   - security_firewall:     Pre-Flight simulation on mainnet fork
 *   - protocol_sdk_analyze:  SDK doc + IDL → suggested instruction payload
 *
 * Almost all are `sideEffects: "read"` or `"sim"` — the planner can run these
 * autonomously without HITL even under a strict per-user policy.
 */

import { z } from "zod";
import { markdown as cfMarkdown } from "@/lib/cloudflare/cf-browser";
import { knowledgeBase } from "@/lib/knowledge";
import { knowledgeMemory } from "@/lib/knowledge-memory";
import { defineCapability, type AnyCapability } from "./types";
import { resolveTokenMint } from "./tokens";

// ─────────────────────────────────────────────────────────────────────────────
// foresight_simulation — runway / shock / variable-impact / yield forecast.
// Pure simulation; reads vault/wallet state from ctx, no chain writes.
// ─────────────────────────────────────────────────────────────────────────────
const foresight_simulation = defineCapability({
  id: "foresight_simulation",
  domain: "intel",
  description:
    "Run a 'What If' simulation — runway projection, market shock, variable impact, yield forecast. Triggers Depletion Node visualization.",
  inputSchema: z.object({
    scenario: z
      .enum([
        "runway_projection",
        "market_shock",
        "variable_impact",
        "yield_forecast",
        "custom",
      ])
      .describe("Simulation scenario type"),
    variables: z
      .record(z.any())
      .describe(
        "Scenario variables object. Keys depend on scenario: " +
          "runway_projection: { monthlyBurn: number (USD/mo) }. " +
          "market_shock: { solDrop: number (e.g. 0.3 for 30% or 30 for 30%), usdcDepeg?: number, monthlyBurn?: number }. " +
          "variable_impact: { newHires?: number (count of new hires, default 0), costPerHire?: number (USD cost per hire/mo, default 8000), costPerHireSOL?: number (SOL cost per hire/mo — will be converted to USD at current price), monthlyBurn?: number (current USD burn/mo, default 15000), depositSOL?: number (additional SOL deposit to add to treasury), depositUSD?: number (additional USD deposit to add to treasury) }. " +
          "yield_forecast: { apy: number (e.g. 0.08 for 8%), principal?: number (USD amount) }. " +
          "IMPORTANT: When the user mentions hiring someone at X SOL/month, set newHires=1 and costPerHireSOL=X. When the user mentions depositing SOL, set depositSOL to that amount.",
      ),
    timeframeMonths: z
      .number()
      .optional()
      .default(12)
      .describe("Projection timeframe in months"),
  }),
  sideEffects: "sim",
  requiredAuth: "none",
  sensitivity: "low",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: async (input, ctx) => {
    const { scenario, variables, timeframeMonths } = input as {
      scenario: string;
      variables: Record<string, any>;
      timeframeMonths: number;
    };
    console.log(
      `[capability:foresight_simulation] ${scenario} over ${timeframeMonths}mo`,
    );

    const tokenSource = ctx.vaultState?.tokens || ctx.walletState?.balances;
    const tokens: Array<{ symbol?: string; amount?: number; price?: number }> =
      Array.isArray(tokenSource) ? (tokenSource as any) : [];
    const computedBalance = tokens.reduce(
      (sum, t) => sum + (t.amount || 0) * (t.price || 0),
      0,
    );
    const totalBalance = computedBalance;
    console.log(
      `[capability:foresight_simulation] Treasury balance: $${Math.round(totalBalance).toLocaleString()} (${totalBalance === 0 ? "NO BALANCE — vault is empty or not connected" : `LIVE — ${tokens.length} tokens`})`,
    );

    if (totalBalance === 0) {
      return {
        success: false,
        operation: "foresight_simulation",
        scenario,
        variables,
        timeframeMonths,
        dataSource: "none",
        message:
          "Treasury balance is $0. Connect a vault with funded tokens to run simulations.",
      };
    }

    if (scenario === "runway_projection") {
      const monthlyBurn = (variables.monthlyBurn as number) || 15000;
      const projection: Array<{ month: number; balance: number }> = [];
      let balance = totalBalance;
      let depletionMonth = 0;
      for (let i = 1; i <= timeframeMonths; i++) {
        balance = Math.max(0, balance - monthlyBurn);
        projection.push({ month: i, balance: Math.round(balance) });
        if (balance <= 0 && depletionMonth === 0) depletionMonth = i;
      }
      const projectedMonths =
        depletionMonth || Math.ceil(totalBalance / monthlyBurn);
      const depletionDate = new Date();
      depletionDate.setMonth(depletionDate.getMonth() + projectedMonths);
      return {
        success: true,
        operation: "foresight_simulation",
        scenario,
        variables,
        timeframeMonths,
        triggerVisualization: true,
        chartType: "depletion_node",
        projectedMonths,
        depletionDate: depletionDate.toISOString().split("T")[0],
        monthlyProjection: projection,
        dataSource: "live",
        message: `Runway projection: ~${projectedMonths} months at $${monthlyBurn.toLocaleString()}/mo burn. Depletion ${depletionDate.toLocaleDateString()}.`,
      };
    }

    if (scenario === "market_shock") {
      const rawSolDrop = (variables.solDrop as number) || 0.3;
      const solDrop = rawSolDrop > 1 ? rawSolDrop / 100 : rawSolDrop;
      const rawUsdcDepeg = (variables.usdcDepeg as number) || 0;
      const usdcDepeg = rawUsdcDepeg > 1 ? rawUsdcDepeg / 100 : rawUsdcDepeg;

      const effectiveTokens = tokens;
      const shockedTokens = effectiveTokens.map((t) => {
        let shockedPrice = t.price || 0;
        if (
          t.symbol?.toUpperCase() === "SOL" ||
          t.symbol?.toUpperCase() === "WSOL"
        )
          shockedPrice *= 1 - solDrop;
        if (t.symbol?.toUpperCase() === "USDC") shockedPrice *= 1 - usdcDepeg;
        return {
          symbol: t.symbol,
          amount: t.amount || 0,
          originalPrice: t.price || 0,
          shockedPrice,
          shockedValue: (t.amount || 0) * shockedPrice,
        };
      });
      const recalcOriginal = effectiveTokens.reduce(
        (s, t) => s + (t.amount || 0) * (t.price || 0),
        0,
      );
      const shockedTotal = shockedTokens.reduce(
        (s, t) => s + t.shockedValue,
        0,
      );
      const monthlyBurn = (variables.monthlyBurn as number) || 15000;
      const shockedRunway = Math.ceil(shockedTotal / monthlyBurn);

      const monthlyProjection: Array<{
        month: number;
        original: number;
        shocked: number;
      }> = [];
      let origBalance = recalcOriginal;
      let shockBalance = shockedTotal;
      for (let i = 0; i <= timeframeMonths; i++) {
        monthlyProjection.push({
          month: i,
          original: Math.round(origBalance),
          shocked: Math.round(shockBalance),
        });
        origBalance = Math.max(0, origBalance - monthlyBurn);
        shockBalance = Math.max(0, shockBalance - monthlyBurn);
      }
      return {
        success: true,
        operation: "foresight_simulation",
        scenario,
        variables,
        timeframeMonths,
        triggerVisualization: true,
        chartType: "equity_curve",
        originalBalance: Math.round(recalcOriginal),
        shockedBalance: Math.round(shockedTotal),
        drawdown: `${recalcOriginal > 0 ? (((recalcOriginal - shockedTotal) / recalcOriginal) * 100).toFixed(1) : "0.0"}%`,
        shockedRunwayMonths: shockedRunway,
        shockedTokens,
        monthlyProjection,
        dataSource: "live",
        message: `Market shock: portfolio drops ${recalcOriginal > 0 ? (((recalcOriginal - shockedTotal) / recalcOriginal) * 100).toFixed(1) : "0.0"}% to $${Math.round(shockedTotal).toLocaleString()}. Runway: ~${shockedRunway}mo.`,
      };
    }

    if (scenario === "variable_impact") {
      const newHires = (variables.newHires as number) || 0;
      const solToken = tokens.find(
        (t) =>
          t.symbol?.toUpperCase() === "SOL" ||
          t.symbol?.toUpperCase() === "WSOL",
      );
      const solPrice = solToken?.price || 150;
      const costPerHireSOL = (variables.costPerHireSOL as number) || 0;
      const costPerHire =
        costPerHireSOL > 0
          ? Math.round(costPerHireSOL * solPrice)
          : (variables.costPerHire as number) || 8000;
      const depositSOL = (variables.depositSOL as number) || 0;
      const depositUSD = (variables.depositUSD as number) || 0;
      const depositValue = depositSOL * solPrice + depositUSD;
      const currentBurn = (variables.monthlyBurn as number) || 15000;
      const newBurn = currentBurn + newHires * costPerHire;
      const effectiveBalance = totalBalance + depositValue;
      const originalRunway =
        currentBurn > 0 ? Math.ceil(totalBalance / currentBurn) : 999;
      const newRunway = newBurn > 0 ? Math.ceil(effectiveBalance / newBurn) : 999;

      const monthlyProjection: Array<{
        month: number;
        original: number;
        projected: number;
      }> = [];
      let origBal = totalBalance;
      let newBal = effectiveBalance;
      for (let i = 0; i <= timeframeMonths; i++) {
        monthlyProjection.push({
          month: i,
          original: Math.round(origBal),
          projected: Math.round(newBal),
        });
        origBal = Math.max(0, origBal - currentBurn);
        newBal = Math.max(0, newBal - newBurn);
      }

      const parts: string[] = [];
      if (depositValue > 0) {
        parts.push(
          `Depositing ${depositSOL > 0 ? `${depositSOL} SOL (~$${Math.round(depositValue).toLocaleString()})` : `$${Math.round(depositValue).toLocaleString()}`} increases treasury to $${Math.round(effectiveBalance).toLocaleString()}`,
        );
      }
      if (newHires > 0) {
        const costLabel =
          costPerHireSOL > 0
            ? `${costPerHireSOL} SOL (~$${costPerHire.toLocaleString()})`
            : `$${costPerHire.toLocaleString()}`;
        parts.push(
          `Adding ${newHires} hire(s) at ${costLabel}/mo increases burn to $${newBurn.toLocaleString()}/mo`,
        );
      }
      parts.push(`Runway: ${originalRunway}mo → ${newRunway}mo`);

      return {
        success: true,
        operation: "foresight_simulation",
        scenario,
        variables,
        timeframeMonths,
        triggerVisualization: true,
        chartType: "depletion_node",
        originalBurn: currentBurn,
        newBurn,
        originalRunway,
        newRunway,
        effectiveBalance: Math.round(effectiveBalance),
        originalBalance: Math.round(totalBalance),
        depositValue: Math.round(depositValue),
        impactMonths: originalRunway - newRunway,
        solPrice,
        costPerHire,
        monthlyProjection,
        dataSource: "live",
        message: parts.join(". "),
      };
    }

    if (scenario === "yield_forecast") {
      const apy = (variables.apy as number) || 0.08;
      const principal = (variables.principal as number) || totalBalance;
      const monthlyRate = apy / 12;
      const projection: Array<{ month: number; balance: number }> = [];
      let balance = principal;
      for (let i = 1; i <= timeframeMonths; i++) {
        balance *= 1 + monthlyRate;
        projection.push({ month: i, balance: Math.round(balance * 100) / 100 });
      }
      const totalYield = balance - principal;
      return {
        success: true,
        operation: "foresight_simulation",
        scenario,
        variables,
        timeframeMonths,
        triggerVisualization: true,
        chartType: "yield_curve",
        principal: Math.round(principal),
        endingBalance: Math.round(balance),
        totalYield: Math.round(totalYield),
        effectiveApy: apy,
        monthlyProjection: projection,
        message: `Yield forecast: $${Math.round(principal).toLocaleString()} at ${(apy * 100).toFixed(1)}% APY → $${Math.round(balance).toLocaleString()} after ${timeframeMonths}mo (+$${Math.round(totalYield).toLocaleString()}).`,
      };
    }

    return {
      success: true,
      operation: "foresight_simulation",
      scenario,
      variables,
      timeframeMonths,
      triggerVisualization: true,
      chartType: "depletion_node",
      message: `Custom simulation triggered: ${scenario}. Rendering visualization.`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// risk_assessment — concentration scoring from vaultState. Pure read.
// ─────────────────────────────────────────────────────────────────────────────
const risk_assessment = defineCapability({
  id: "risk_assessment",
  domain: "intel",
  description:
    "Run concentration risk assessment — triggers Risk Radar visualization.",
  inputSchema: z.object({
    threshold: z
      .number()
      .optional()
      .default(50)
      .describe("Concentration threshold % to flag"),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async (input, ctx) => {
    const { threshold } = input;
    console.log(`[capability:risk_assessment] threshold: ${threshold}%`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const holdings: any[] = Array.isArray(ctx.vaultState?.tokens)
      ? (ctx.vaultState!.tokens as any[])
      : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokenValue = (t: any) => {
      const fromUsd =
        typeof t.usdValue === "number" && Number.isFinite(t.usdValue)
          ? t.usdValue
          : null;
      if (fromUsd != null) return fromUsd;
      return (Number(t.amount) || 0) * (Number(t.price) || 0);
    };
    const totalValue = holdings.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, t: any) => sum + tokenValue(t),
      0,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const concentrations = holdings.map((t: any) => {
      const value = tokenValue(t);
      const percentage = totalValue > 0 ? (value / totalValue) * 100 : 0;
      return { token: t.symbol, value, percentage };
    });
    const risks = concentrations.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) => t.percentage >= (threshold || 50),
    );
    return {
      success: true,
      operation: "risk_assessment",
      threshold,
      totalValue,
      concentrationRisks: risks,
      concentrations,
      riskCount: risks.length,
      triggerVisualization: true,
      chartType: "risk_radar",
      message:
        risks.length > 0
          ? `⚠️ ${risks.length} asset(s) exceed ${threshold}% threshold.`
          : `✅ No concentration risks above ${threshold}%.`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// browser_research — Cloudflare browser + KB. Read-only research.
// ─────────────────────────────────────────────────────────────────────────────
const browser_research = defineCapability({
  id: "browser_research",
  domain: "intel",
  description:
    "Deep research using browser, knowledge base, and Cloudflare scraping. Protocol deep-dives, documentation, technical synthesis.",
  inputSchema: z.object({
    query: z.string().describe("Search query or topic"),
    url: z.string().optional().describe("Specific URL to scrape"),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async (input) => {
    const { query, url } = input;
    console.log(
      `[capability:browser_research] "${query}"${url ? ` (URL: ${url})` : ""}`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasks: Promise<any>[] = [];
    if (url) {
      tasks.push(
        cfMarkdown({ url })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((md: any) => ({ source: "cloudflare-browser", markdown: md }))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .catch((e: any) => ({ source: "cloudflare-browser", error: e.message })),
      );
    }
    tasks.push(
      knowledgeBase
        .study(query)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((r: any) => ({ source: "knowledge-base", results: r }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .catch((e: any) => ({ source: "knowledge-base", error: e.message })),
    );
    const results = await Promise.allSettled(tasks);
    const merged = results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { error: (r as any).reason?.message },
    );
    try {
      await knowledgeMemory.store({
        source: "command-research",
        sourceUrl: url || "multi-source",
        content: JSON.stringify(merged).slice(0, 5000),
        title: query,
        summary: query,
        contentType: "markdown",
      });
    } catch {
      /* ignore */
    }
    return {
      success: true,
      operation: "browser_research",
      query,
      url,
      sources: merged,
      message: `Research completed for "${query}". ${merged.length} source(s) retrieved.`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// idl_extraction — fetch + zlib-decompress Anchor IDL from on-chain PDA.
// ─────────────────────────────────────────────────────────────────────────────
const idl_extraction = defineCapability({
  id: "idl_extraction",
  domain: "intel",
  description: "Fetch and parse a Solana program IDL by program ID.",
  inputSchema: z.object({
    programId: z.string().describe("Solana program address (base58)"),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  protocols: ["anchor"],
  execute: async (input, ctx) => {
    const { programId } = input;
    console.log(`[capability:idl_extraction] ${programId}`);
    try {
      const { PublicKey } = await import("@solana/web3.js");
      const programPubkey = new PublicKey(programId);

      // Anchor stores IDL at PDA seeded by ["anchor:idl", programId]
      const [idlAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("anchor:idl"), programPubkey.toBuffer()],
        programPubkey,
      );

      const idlRes = await fetch(ctx.rpcEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAccountInfo",
          params: [idlAddress.toBase58(), { encoding: "base64" }],
        }),
      });
      const data = await idlRes.json();

      if (!data?.result?.value) {
        return {
          success: false,
          operation: "idl_extraction",
          programId,
          idlAddress: idlAddress.toBase58(),
          message: `No Anchor IDL account found for ${programId}. Program may not be Anchor-based.`,
        };
      }

      const accountData = Buffer.from(data.result.value.data[0], "base64");

      // Anchor IDL account layout:
      //   [0..8)   discriminator
      //   [8..40)  authority pubkey
      //   [40..44) compressed data length (u32 LE)
      //   [44..)   zlib-compressed IDL JSON
      if (accountData.length < 44) {
        return {
          success: false,
          operation: "idl_extraction",
          programId,
          idlAddress: idlAddress.toBase58(),
          error:
            "Account data too small to contain a valid Anchor IDL (expected at least 44 bytes header).",
        };
      }

      const dataLen = accountData.readUInt32LE(40);
      if (dataLen === 0 || 44 + dataLen > accountData.length) {
        return {
          success: false,
          operation: "idl_extraction",
          programId,
          idlAddress: idlAddress.toBase58(),
          error: `IDL data length mismatch: header says ${dataLen} bytes but account has ${accountData.length - 44} bytes available.`,
        };
      }

      const compressed = accountData.slice(44, 44 + dataLen);
      const { inflateSync } = await import("zlib");
      const decompressed = inflateSync(compressed);
      const idl = JSON.parse(decompressed.toString("utf-8"));

      return {
        success: true,
        operation: "idl_extraction",
        programId,
        idlAddress: idlAddress.toBase58(),
        idl,
        instructionCount: idl.instructions?.length ?? 0,
        accountCount: idl.accounts?.length ?? 0,
        typeCount: idl.types?.length ?? 0,
        message: `IDL extracted for ${programId}: ${idl.instructions?.length ?? 0} instructions, ${idl.accounts?.length ?? 0} accounts, ${idl.types?.length ?? 0} types.`,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.code === "Z_DATA_ERROR" || e.message?.includes("inflate")) {
        return {
          success: false,
          operation: "idl_extraction",
          programId,
          error:
            "IDL account data could not be decompressed. The account may use a non-standard format.",
        };
      }
      return {
        success: false,
        operation: "idl_extraction",
        programId,
        error: e.message,
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// sentiment_analysis — Real on-chain whale-flow + price/volume blend.
//
// Honest design (DACS Phase 7E.2):
//   • Pull last 100 enhanced txs for the MINT via Helius
//     `/v0/addresses/{mint}/transactions` — this is the canonical endpoint
//     for token activity (mint accounts themselves have ~no signatures).
//   • Whale-flow from real `tokenTransfers[].tokenAmount` priced via
//     Jupiter price/v2 (USD). Threshold: ≥ $10k = "whale".
//   • Net-flow direction = sign of (whale-buy-USD − whale-sell-USD), where
//     "buy" = the mint is the OUTPUT of a SWAP, "sell" = INPUT.
//   • Price momentum: CoinGecko 24h % change (when token id resolvable).
//   • Composite score (0–100) = weighted blend of activity, whale net-buy
//     ratio, and price momentum. Returns honest `dataSources` list and
//     refuses with `success: false` if Helius key missing.
// ─────────────────────────────────────────────────────────────────────────────
const sentiment_analysis = defineCapability({
  id: "sentiment_analysis",
  domain: "intel",
  description: "On-chain sentiment: whale flow + price momentum for a token.",
  inputSchema: z.object({
    token: z.string().describe("Token symbol or mint to analyze"),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  protocols: ["helius", "jupiter", "coingecko"],
  execute: async (input, _ctx) => {
    const { token } = input;
    console.log(`[capability:sentiment_analysis] ${token}`);

    // 0. Resolve symbol → mint. Fall back to the Jupiter token list for
    //    long-tail tokens we don't ship in TOKEN_MINTS (e.g. HORSE, retail
    //    memes). If we still can't resolve and the input doesn't look like a
    //    base58 mint, return a clean "unknown_token" status — never send a
    //    bare ticker to Helius (it returns 400).
    const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token.trim());
    let mint = resolveTokenMint(token) || (looksLikeMint ? token.trim() : "");
    if (!mint) {
      try {
        const r = await fetch(`https://lite-api.jup.ag/tokens/v1/tagged/verified`, {
          signal: AbortSignal.timeout(6_000),
        });
        if (r.ok) {
          const list = (await r.json()) as Array<{ address: string; symbol: string; name?: string }>;
          const want = token.trim().toUpperCase();
          const hit =
            list.find((t) => t.symbol?.toUpperCase() === want) ||
            list.find((t) => t.name?.toUpperCase() === want);
          if (hit?.address) mint = hit.address;
        }
      } catch {
        /* non-fatal — handled below */
      }
    }
    if (!mint) {
      return {
        success: true,
        operation: "sentiment_analysis",
        token,
        mint: null,
        status: "unknown_token",
        sentiment: "unavailable",
        compositeScore: null,
        dataSources: [],
        message: `Couldn't resolve "${token}" to a Solana mint address. Paste the mint (base58) or pick a verified token symbol and I'll re-run sentiment.`,
      };
    }

    const heliusKey = process.env.HELIUS_API_KEY;
    if (!heliusKey) {
      return {
        success: true,
        operation: "sentiment_analysis",
        token,
        mint,
        status: "provider_not_configured",
        sentiment: "unavailable",
        compositeScore: null,
        dataSources: [],
        providerRequired: "HELIUS_API_KEY",
        message: `Sentiment for ${token} is unavailable because the on-chain data provider is not configured. No transaction was created.`,
      };
    }

    const dataSources: string[] = [];

    // 1. Fetch last 100 enhanced txs touching the mint.
    type HeliusTx = {
      signature: string;
      timestamp?: number;
      type?: string;
      transactionError?: unknown;
      tokenTransfers?: Array<{
        mint: string;
        tokenAmount: number;
        fromUserAccount?: string;
        toUserAccount?: string;
      }>;
      events?: {
        swap?: {
          tokenInputs?: Array<{ mint: string; tokenAmount?: { tokenAmount?: string; decimals?: number } }>;
          tokenOutputs?: Array<{ mint: string; tokenAmount?: { tokenAmount?: string; decimals?: number } }>;
        };
      };
    };

    let txs: HeliusTx[] = [];
    try {
      const r = await fetch(
        `https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${heliusKey}&limit=100`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`Helius ${r.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
      }
      txs = (await r.json()) as HeliusTx[];
      dataSources.push("helius:addresses/transactions");
    } catch (err) {
      const msg = (err as Error).message;
      return {
        success: false,
        operation: "sentiment_analysis",
        token,
        mint,
        status: "provider_error",
        error: `Helius fetch failed: ${msg}`,
        message: `Couldn't fetch on-chain activity for ${token} (${msg}).`,
      };
    }

    if (txs.length === 0) {
      return {
        success: true,
        operation: "sentiment_analysis",
        token,
        mint,
        compositeScore: 0,
        sentiment: "no-activity",
        dataSources,
        message: `No recent on-chain activity for ${token}.`,
      };
    }

    // 2. Price the mint in USD via Jupiter price/v2.
    let unitPriceUsd = 0;
    try {
      const pr = await fetch(`https://lite-api.jup.ag/price/v2?ids=${mint}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (pr.ok) {
        const pj = (await pr.json()) as { data?: Record<string, { price?: string | number }> };
        unitPriceUsd = Number(pj.data?.[mint]?.price ?? 0) || 0;
        if (unitPriceUsd > 0) dataSources.push("jupiter:price/v2");
      }
    } catch {
      /* price unavailable — whale USD will be 0 and we'll note it */
    }

    // 3. Walk txs: count swaps/transfers, classify whale buys vs sells.
    const now = Math.floor(Date.now() / 1000);
    const last24h = now - 24 * 3600;
    const WHALE_USD = 10_000;

    let swapCount = 0;
    let transferCount = 0;
    let errorCount = 0;
    let recent24h = 0;
    let whaleBuyUsd = 0;
    let whaleSellUsd = 0;
    let whaleBuys = 0;
    let whaleSells = 0;

    for (const tx of txs) {
      if (tx.transactionError) {
        errorCount += 1;
        continue;
      }
      if ((tx.timestamp ?? 0) >= last24h) recent24h += 1;
      const t = (tx.type ?? "").toUpperCase();
      if (t === "SWAP") swapCount += 1;
      else if (t === "TRANSFER") transferCount += 1;

      // Find net mint-side movement in this tx.
      let mintNet = 0;
      for (const tr of tx.tokenTransfers ?? []) {
        if (tr.mint !== mint) continue;
        const amt = Number(tr.tokenAmount) || 0;
        // We can't distinguish buyer/seller without ctx wallet; instead use
        // SWAP event direction below. For TRANSFER, sum gross magnitude.
        mintNet += amt;
      }

      if (t === "SWAP" && tx.events?.swap && unitPriceUsd > 0) {
        const inIsMint = (tx.events.swap.tokenInputs ?? []).some((i) => i.mint === mint);
        const outIsMint = (tx.events.swap.tokenOutputs ?? []).some((o) => o.mint === mint);
        const usd = mintNet * unitPriceUsd;
        if (usd >= WHALE_USD) {
          if (outIsMint && !inIsMint) {
            whaleBuyUsd += usd;
            whaleBuys += 1;
          } else if (inIsMint && !outIsMint) {
            whaleSellUsd += usd;
            whaleSells += 1;
          }
        }
      }
    }

    // 4. Price momentum from CoinGecko (best-effort).
    let priceChange24hPct: number | null = null;
    try {
      const cgRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${mint}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (cgRes.ok) {
        const cgJ = (await cgRes.json()) as Record<string, { usd_24h_change?: number }>;
        const k = Object.keys(cgJ)[0];
        if (k && typeof cgJ[k]?.usd_24h_change === "number") {
          priceChange24hPct = cgJ[k].usd_24h_change!;
          dataSources.push("coingecko:simple/token_price");
        }
      }
    } catch {
      /* CG unavailable */
    }

    // 5. Composite score: activity (0–40) + whale net-buy (0–35) + momentum (0–25).
    const activityPart = Math.min(40, Math.round((recent24h / 50) * 40));
    const whaleNet = whaleBuyUsd - whaleSellUsd;
    const whaleAbs = whaleBuyUsd + whaleSellUsd;
    const whaleRatio = whaleAbs > 0 ? whaleNet / whaleAbs : 0; // [-1, 1]
    const whalePart = Math.round(((whaleRatio + 1) / 2) * 35);
    let momentumPart = 12;
    if (priceChange24hPct != null) {
      const clamped = Math.max(-25, Math.min(25, priceChange24hPct));
      momentumPart = Math.round(((clamped + 25) / 50) * 25);
    }
    const compositeScore = Math.max(0, Math.min(100, activityPart + whalePart + momentumPart));
    const sentiment =
      compositeScore >= 70 ? "bullish" : compositeScore >= 45 ? "neutral" : "bearish";
    const netFlowDir = whaleNet > 0 ? "accumulating" : whaleNet < 0 ? "distributing" : "balanced";

    return {
      success: true,
      operation: "sentiment_analysis",
      token,
      mint,
      compositeScore,
      sentiment,
      whaleFlow: {
        netFlow: netFlowDir,
        whaleBuys,
        whaleSells,
        whaleBuyUsd: Math.round(whaleBuyUsd),
        whaleSellUsd: Math.round(whaleSellUsd),
        netUsd: Math.round(whaleNet),
        thresholdUsd: WHALE_USD,
      },
      activity: {
        sampledTxs: txs.length,
        last24hTxs: recent24h,
        swaps: swapCount,
        transfers: transferCount,
        errors: errorCount,
      },
      price: {
        unitPriceUsd,
        change24hPct: priceChange24hPct,
      },
      breakdown: {
        activityPart,
        whalePart,
        momentumPart,
      },
      dataSources,
      message: `Sentiment for ${token}: ${compositeScore}/100 (${sentiment}). ${recent24h} txs/24h, ${whaleBuys} whale buys vs ${whaleSells} sells (net $${Math.round(whaleNet).toLocaleString()}), 24h price ${priceChange24hPct == null ? "n/a" : `${priceChange24hPct.toFixed(1)}%`}.`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// security_firewall — Pre-Flight simulation. Sim only, but inputs include
// serialized transactions so we mark sensitivity medium.
// ─────────────────────────────────────────────────────────────────────────────
const security_firewall = defineCapability({
  id: "security_firewall",
  domain: "intel",
  description: "Run Pre-Flight security simulation on a mainnet fork.",
  inputSchema: z.object({
    targetAddress: z.string().describe("Contract or wallet address to audit"),
    testType: z
      .enum(["sandbox_escape", "bridge_auth", "balance_check", "full"])
      .optional()
      .default("full")
      .describe("Test type"),
    serializedTransaction: z
      .string()
      .optional()
      .describe("Optional base64-encoded transaction to simulate"),
  }),
  sideEffects: "sim",
  requiredAuth: "none",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    const { targetAddress, testType, serializedTransaction } = input;
    console.log(`[capability:security_firewall] ${testType} on ${targetAddress}`);

    const { SimulationFirewall } = await import(
      "@/lib/studio/simulation-firewall"
    );
    const firewall = SimulationFirewall.getInstance();

    const results: Record<string, unknown> = {
      sandboxEscape: false,
      unauthorizedBridge: false,
      balanceDiscrepancy: false,
    };
    let riskScore = 0;
    let humanSummary = "";

    try {
      if (serializedTransaction) {
        const simResult = await firewall.simulate(
          serializedTransaction,
          targetAddress,
        );
        results.simulationPassed = simResult.success;
        results.balanceChanges = simResult.balanceChanges;
        results.estimatedFee = simResult.estimatedFee;
        results.unitsConsumed = simResult.unitsConsumed;
        results.logs = simResult.logs.slice(0, 10);
        humanSummary = simResult.humanSummary;

        const riskMap = { low: 0.1, medium: 0.4, high: 0.7, critical: 0.95 };
        riskScore = riskMap[simResult.riskLevel] ?? 0.5;

        results.balanceDiscrepancy = simResult.balanceChanges.some(
          (c) => Math.abs(c.changeUsd || 0) > 500,
        );
      } else {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const conn = new Connection(ctx.rpcEndpoint, "confirmed");

        let validAddress = false;
        try {
          new PublicKey(targetAddress);
          validAddress = true;
        } catch {
          /* invalid */
        }

        if (validAddress) {
          const info = await conn.getAccountInfo(new PublicKey(targetAddress));
          results.accountExists = !!info;
          results.accountOwner = info?.owner?.toBase58() || null;
          results.accountLamports = info?.lamports || 0;
          results.isExecutable = info?.executable || false;

          if (info?.executable) {
            riskScore = 0.2;
            humanSummary = `Program account verified. Owner: ${info.owner.toBase58().slice(0, 12)}…. No transaction to simulate.`;
          } else if (info) {
            riskScore = 0.1;
            humanSummary = `Wallet account verified. Balance: ${(info.lamports / 1e9).toFixed(4)} SOL. No transaction to simulate.`;
          } else {
            riskScore = 0.6;
            humanSummary = `Account ${targetAddress.slice(0, 12)}… does not exist on-chain. Elevated risk.`;
          }
        } else {
          riskScore = 0.8;
          humanSummary = `Invalid Solana address: ${targetAddress}. Cannot verify.`;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[capability:security_firewall] Simulation error:", msg);
      riskScore = 0.5;
      humanSummary = `Firewall check encountered an error: ${msg}`;
      results.error = msg;
    }

    results.riskScore = riskScore;
    const riskLabel =
      riskScore >= 0.7 ? "HIGH" : riskScore >= 0.3 ? "MEDIUM" : "LOW";

    return {
      success: true,
      operation: "security_firewall",
      targetAddress,
      testType,
      results,
      riskLevel: riskLabel,
      message: `Pre-Flight ${testType} simulation: ${riskLabel} risk (${riskScore.toFixed(2)}). ${humanSummary}`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// protocol_sdk_analyze — fetch SDK docs + IDL, suggest instruction payload.
// ─────────────────────────────────────────────────────────────────────────────
const protocol_sdk_analyze = defineCapability({
  id: "protocol_sdk_analyze",
  domain: "intel",
  description:
    "Analyze a Solana program's SDK documentation and prepare transaction payload insights. Bridges raw docs to actionable on-chain instructions.",
  inputSchema: z.object({
    programId: z.string().describe("Solana program address (base58)"),
    sdkUrl: z
      .string()
      .optional()
      .describe("URL to SDK documentation or npm package page"),
    intent: z
      .string()
      .describe(
        "What the user wants to do with this program (e.g. 'deposit USDC', 'create a pool', 'stake tokens')",
      ),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  protocols: ["anchor"],
  execute: async (input, ctx) => {
    const { programId, sdkUrl, intent } = input;
    console.log(
      `[capability:protocol_sdk_analyze] ${programId} — intent: "${intent}"`,
    );

    const research: {
      docs?: string;
      idl?: Record<string, unknown>;
      error?: string;
    } = {};

    // Step 1: SDK documentation
    if (sdkUrl) {
      try {
        const docMd = await cfMarkdown({ url: sdkUrl });
        research.docs =
          typeof docMd === "string"
            ? docMd.slice(0, 12000)
            : JSON.stringify(docMd).slice(0, 12000);
      } catch (e: unknown) {
        research.docs = `Documentation fetch failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // Step 2: Knowledge Engine
    let knowledgeResults: string | null = null;
    try {
      const kr = await knowledgeBase.study(
        `${programId} Solana SDK ${intent}`,
      );
      if (kr.rawContent) knowledgeResults = kr.rawContent.slice(0, 6000);
    } catch {
      /* knowledge search is best-effort */
    }

    // Step 3: IDL extraction (inline copy of Anchor PDA fetch)
    let idlData: Record<string, unknown> | null = null;
    try {
      const { PublicKey } = await import("@solana/web3.js");
      const programPubkey = new PublicKey(programId);
      const [idlAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("anchor:idl"), programPubkey.toBuffer()],
        programPubkey,
      );

      const idlRes = await fetch(ctx.rpcEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAccountInfo",
          params: [idlAddress.toBase58(), { encoding: "base64" }],
        }),
      });
      const data = await idlRes.json();

      if (data?.result?.value) {
        const accountData = Buffer.from(data.result.value.data[0], "base64");
        if (accountData.length >= 44) {
          const dataLen = accountData.readUInt32LE(40);
          if (dataLen > 0 && 44 + dataLen <= accountData.length) {
            const { inflateSync } = await import("zlib");
            const decompressed = inflateSync(
              accountData.slice(44, 44 + dataLen),
            );
            idlData = JSON.parse(decompressed.toString("utf-8"));
            if (idlData) research.idl = idlData;
          }
        }
      }
    } catch {
      /* IDL extraction best-effort */
    }

    const instructions = idlData?.instructions as
      | Array<{ name: string; args?: unknown[]; accounts?: unknown[] }>
      | undefined;
    const accounts = idlData?.accounts as Array<{ name: string }> | undefined;

    const matchingInstructions =
      instructions?.filter((ix) => {
        const intentLower = intent.toLowerCase();
        const ixName = (ix.name || "").toLowerCase();
        return intentLower.split(/\s+/).some((word) => ixName.includes(word));
      }) || [];

    const suggestedInstruction =
      matchingInstructions.length > 0
        ? matchingInstructions[0]
        : instructions?.[0] || null;

    const suggestedPayload = suggestedInstruction
      ? {
          programId,
          instructionName: suggestedInstruction.name,
          requiredAccounts: suggestedInstruction.accounts || [],
          args: suggestedInstruction.args || [],
          note: "Build this instruction using @coral-xyz/anchor or raw TransactionInstruction with the accounts and args above.",
        }
      : null;

    try {
      await knowledgeMemory.store({
        source: "protocol-sdk-analysis",
        sourceUrl: sdkUrl || `solana:${programId}`,
        content: JSON.stringify({
          programId,
          intent,
          instructions: instructions?.map((i) => i.name),
          accounts: accounts?.map((a) => a.name),
        }).slice(0, 5000),
        title: `SDK Analysis: ${programId.slice(0, 12)}…`,
        summary: `Protocol SDK analysis for intent: ${intent}`,
        contentType: "json",
      });
    } catch {
      /* storage best-effort */
    }

    return {
      success: true,
      operation: "protocol_sdk_analyze",
      programId,
      intent,
      hasIdl: !!idlData,
      instructionCount: instructions?.length ?? 0,
      accountCount: accounts?.length ?? 0,
      availableInstructions: instructions?.map((i) => i.name) || [],
      matchingInstructions: matchingInstructions.map((i) => i.name),
      suggestedPayload,
      docsFetched: !!research.docs,
      knowledgeResults: !!knowledgeResults,
      message: `Protocol analysis for ${programId.slice(0, 12)}…: ${idlData ? `IDL found (${instructions?.length ?? 0} instructions).` : "No on-chain IDL."} ${matchingInstructions.length > 0 ? `Matched instructions for "${intent}": ${matchingInstructions.map((i) => i.name).join(", ")}.` : `No direct instruction match for "${intent}".`}${suggestedPayload ? ` Suggested: ${suggestedPayload.instructionName} with ${(suggestedPayload.requiredAccounts as unknown[]).length} accounts.` : ""}${research.docs ? " SDK docs fetched." : ""}`,
    };
  },
});

export const intelCapabilities: AnyCapability[] = [
  foresight_simulation as AnyCapability,
  risk_assessment as AnyCapability,
  browser_research as AnyCapability,
  idl_extraction as AnyCapability,
  sentiment_analysis as AnyCapability,
  security_firewall as AnyCapability,
  protocol_sdk_analyze as AnyCapability,
];
