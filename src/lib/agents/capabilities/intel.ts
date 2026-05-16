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
import {
  presetScenarioToIR,
  runSimulationIR,
  irToFlatVariables,
  type SimulationIR,
  type IRToken,
} from "@/lib/foresight/simulation-ir";
import { enrichIRWithScenarioAssets } from "@/lib/foresight/token-market";

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
      .string()
      .describe(
        "Simulation scenario type. Known scenarios with dedicated math: 'runway_projection', 'market_shock', 'variable_impact', 'yield_forecast'. " +
          "Any other free-form scenario (e.g. 'diversification', 'rebalance', 'token_concentration', 'inflow_shock', 'fee_optimization', 'bear_case', 'bull_case', etc.) is accepted and routed through the generic 'custom' simulator — pass any descriptive string and put the relevant numeric inputs in `variables`.",
      ),
    variables: z
      .record(z.any())
      .describe(
        "Scenario variables. ALWAYS pass concrete numeric inputs derived from the user's question — never an empty object. " +
          "Known shapes: " +
          "runway_projection: { monthlyBurn: number USD/mo }. " +
          "market_shock: { solDrop: number (0.3 = 30%), usdcDepeg?: number, monthlyBurn?: number }. " +
          "variable_impact: { newHires?: number, costPerHire?: number, costPerHireSOL?: number, monthlyBurn?: number, depositSOL?: number, depositUSD?: number }. " +
          "yield_forecast: { apy: number (0.08 = 8%), principal?: number USD }. " +
          "Free-form scenarios (diversification, rebalance, concentration_reduction, multi_asset_shock, etc.) — pass one of: " +
          "{ targetAllocation: { SYMBOL: percent } } for diversification/rebalance (e.g. { SOL: 50, USDC: 30, JTO: 20 }); " +
          "{ priceShocks: { SYMBOL: pct } } for multi-asset shock; " +
          "{ inflowUSD?: number, outflowUSD?: number } for flow scenarios. " +
          "When the user mentions hiring at X SOL/month, set newHires=1 and costPerHireSOL=X. When the user mentions depositing SOL, set depositSOL.",
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

    // ── IR-first path: try LLM planner, fall back to preset adapter ─────
    // Spam-token guard: many wallets hold airdropped SPL tokens that Jupiter
    // mis-prices into millions/billions. Trust only majors + stables + LSTs;
    // for everything else cap per-token notional at $50k so a single spam
    // mint can't inflate the treasury into the billions.
    const MAJOR = new Set([
      "SOL", "WSOL", "JITOSOL", "MSOL", "BSOL", "JUPSOL", "INF",
      "USDC", "USDT", "USDS", "PYUSD", "DAI", "USDH",
      "JTO", "JUP", "BONK", "WIF", "PYTH", "RNDR", "RAY", "ORCA", "MNDE",
      "ETH", "WETH", "WBTC", "BTC",
    ]);
    const SPAM_CAP_USD = 50_000;
    const irTokens: IRToken[] = tokens
      .filter((t) => (t.amount ?? 0) > 0 && (t.price ?? 0) > 0 && t.symbol)
      .map((t) => {
        const symbol = String(t.symbol).toUpperCase();
        const amount = Number(t.amount) || 0;
        const price = Number(t.price) || 0;
        const notional = amount * price;
        if (!MAJOR.has(symbol) && notional > SPAM_CAP_USD) {
          // Cap by reducing reported amount — keep the token visible but neutered.
          return { symbol, amount: price > 0 ? SPAM_CAP_USD / price : 0, price };
        }
        return { symbol, amount, price };
      })
      .filter((t) => t.amount * t.price >= 1); // drop dust
    // Recompute trusted balance (used downstream for clarify messages).
    const trustedBalance = irTokens.reduce((s, t) => s + t.amount * t.price, 0);
    if (trustedBalance === 0) {
      return {
        success: false,
        operation: "foresight_simulation",
        scenario,
        variables,
        timeframeMonths,
        dataSource: "filtered",
        message:
          "No verified tokens with reliable pricing in this treasury. Connect a vault with SOL, stables, or major SPL tokens to run a simulation.",
        clarifyChips: [
          { id: "connect", label: "Connect a vault", suggestPrompt: "Connect my treasury wallet" },
        ],
        needsClarify: true,
      };
    }

    let ir: SimulationIR | null = null;
    try {
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
      if (baseUrl) {
        const planRes = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/foresight/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: `${scenario}: ${JSON.stringify(variables)}`,
            tokens: irTokens,
            horizonMonths: timeframeMonths,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (planRes.ok) {
          const j = await planRes.json();
          if (j?.ok && j.ir) ir = j.ir as SimulationIR;
        }
      }
    } catch (e) {
      console.warn("[foresight_simulation] planner unavailable, using preset", e);
    }
    if (!ir) {
      ir = presetScenarioToIR({ scenario, variables, timeframeMonths, tokens: irTokens });
    }

    if (ir) {
      ir = await enrichIRWithScenarioAssets(ir);

      // ── Anti-fabrication sanitizer ─────────────────────────────────────
      // Planner is told never to invent monthlyBurn / APY / inflow, but LLMs
      // slip. Strip any flow/yield the user did NOT explicitly ask for and
      // that we have NO baseline for — push to unknowns instead.
      const promptText = `${scenario} ${JSON.stringify(variables)}`.toLowerCase();
      const userMentions = {
        burn: /burn|spend|expense|payroll|cost|salary|opex|outflow/.test(promptText),
        inflow: /inflow|revenue|income|deposit|raise|grant/.test(promptText),
        yield: /yield|apy|stake|staking|earn|interest/.test(promptText),
        hire: /hire|hiring|engineer|headcount/.test(promptText),
      };
      const stripped: string[] = [];
      const keptFlows = (ir.flows || []).filter((f: any) => {
        const k = String(f?.kind || "");
        if (k === "outflow" && !userMentions.burn) { stripped.push(`outflow`); return false; }
        if (k === "inflow" && !userMentions.inflow) { stripped.push(`inflow`); return false; }
        if (k === "hire" && !userMentions.hire) { stripped.push(`hire`); return false; }
        if (k === "yield" && !userMentions.yield) { stripped.push(`yield`); return false; }
        return true;
      });
      if (stripped.length) {
        ir.flows = keptFlows;
        const extra: string[] = [];
        if (stripped.includes("outflow") || stripped.includes("hire")) extra.push("monthlyBurn unknown — ask user");
        if (stripped.includes("inflow")) extra.push("monthlyInflow unknown — ask user");
        if (stripped.includes("yield")) extra.push("yield APY unknown — ask user");
        ir.unknowns = Array.from(new Set([...(ir.unknowns || []), ...extra]));
        console.warn(`[foresight] stripped fabricated flows: ${stripped.join(", ")}`);
      }

      const result = runSimulationIR(ir);
      const flatVariables = irToFlatVariables(ir);

      // ── #3 Clarify gate: when planner flagged unknowns, build click-to-fill chips
      const clarifyChips = (ir.unknowns || []).slice(0, 4).map((u) => {
        const lower = u.toLowerCase();
        if (/burn/.test(lower)) return { id: "burn", label: "Set monthly burn", suggestPrompt: `${scenario} with monthly burn of $15,000` };
        if (/apy|yield/.test(lower)) return { id: "apy", label: "Set yield APY", suggestPrompt: `${scenario} with 8% APY` };
        if (/inflow|revenue/.test(lower)) return { id: "inflow", label: "Set monthly inflow", suggestPrompt: `${scenario} with $10,000 monthly inflow` };
        if (/horizon|months/.test(lower)) return { id: "horizon", label: "Set time horizon", suggestPrompt: `${scenario} over 24 months` };
        return { id: u.slice(0, 20), label: u.slice(0, 60), suggestPrompt: `${scenario}: ${u}` };
      });

      // ── #6 Critique pass (best-effort, never blocks)
      let critique: { verdict: "approved" | "amend"; rationale: string; followUps: string[] } | null = null;
      try {
        const baseUrl =
          process.env.NEXT_PUBLIC_APP_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
        if (baseUrl) {
          const cr = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/foresight/critique`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: `${scenario}: ${JSON.stringify(variables)}`,
              ir,
              result: {
                startValue: result.startValue,
                endValue: result.endValue,
                runwayMonths: result.runwayMonths,
                riskFlags: result.riskFlags,
              },
            }),
            signal: AbortSignal.timeout(6000),
          });
          if (cr.ok) {
            const j = await cr.json();
            if (j?.ok) critique = { verdict: j.verdict, rationale: j.rationale, followUps: j.followUps || [] };
          }
        }
      } catch (e) {
        console.warn("[foresight_simulation] critique offline", e);
      }

      const needsClarify = clarifyChips.length > 0;

      return {
        success: true,
        operation: "foresight_simulation",
        scenario,
        variables,
        timeframeMonths: ir.horizonMonths,
        triggerVisualization: !needsClarify,
        chartType: "depletion_node",
        ir,
        irPlan: {
          horizonMonths: ir.horizonMonths,
          scenarioLabel: ir.scenarioLabel,
          shocks: ir.shocks,
          flows: ir.flows,
          rebalances: ir.rebalances,
          yields: ir.yields,
        },
        flatVariables,
        startValue: Math.round(result.startValue),
        endValue: Math.round(result.endValue),
        runwayMonths: result.runwayMonths,
        riskFlags: result.riskFlags,
        assumptions: ir.assumptions,
        unknowns: ir.unknowns,
        clarifyChips,
        needsClarify,
        critique,
        scenarioLabel: ir.scenarioLabel,
        dataSource: "live",
        message: needsClarify
          ? `${ir.scenarioLabel || scenario}. I need a few more inputs before regenerating analytics: ${ir.unknowns.join("; ")}.`
          : `${ir.scenarioLabel || scenario}. $${Math.round(result.startValue).toLocaleString()} → $${Math.round(result.endValue).toLocaleString()} over ${ir.horizonMonths}mo${result.runwayMonths ? `, depletion @ M${result.runwayMonths}` : ""}.`,
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

    // ── Generic / free-form scenarios ────────────────────────────────────
    // The LLM is expected to pass a meaningful `variables` payload. We try
    // to interpret common shapes so the result is a real simulation, not a
    // placeholder.
    //   - targetAllocation: { SYMBOL: percent }  → diversification / rebalance
    //   - priceShocks: { SYMBOL: pct }           → multi-asset shock
    //   - inflowUSD / outflowUSD per month       → flow scenario
    const targetAllocation = (variables.targetAllocation || variables.allocation || variables.targets) as
      | Record<string, number>
      | undefined;
    if (targetAllocation && typeof targetAllocation === "object") {
      const pctSum = Object.values(targetAllocation).reduce(
        (a, b) => a + (Number(b) || 0),
        0,
      );
      const norm = pctSum > 0 ? pctSum : 100;
      const currentBySymbol: Record<string, number> = {};
      for (const t of tokens) {
        if (!t.symbol) continue;
        currentBySymbol[t.symbol.toUpperCase()] =
          (currentBySymbol[t.symbol.toUpperCase()] || 0) +
          (t.amount || 0) * (t.price || 0);
      }
      const targetUSD: Record<string, number> = {};
      const currentPct: Record<string, number> = {};
      const deltas: Record<string, number> = {};
      for (const sym of Object.keys(targetAllocation)) {
        const SYM = sym.toUpperCase();
        const tgtPct = (Number(targetAllocation[sym]) || 0) / norm;
        targetUSD[SYM] = Math.round(totalBalance * tgtPct * 100) / 100;
        currentPct[SYM] =
          totalBalance > 0
            ? Math.round(((currentBySymbol[SYM] || 0) / totalBalance) * 1000) / 10
            : 0;
        deltas[SYM] =
          Math.round((targetUSD[SYM] - (currentBySymbol[SYM] || 0)) * 100) / 100;
      }
      const summary = Object.entries(targetAllocation)
        .map(([s, p]) => `${Math.round(Number(p))}% ${s.toUpperCase()}`)
        .join(" / ");
      return {
        success: true,
        operation: "foresight_simulation",
        scenario,
        variables,
        timeframeMonths,
        triggerVisualization: true,
        chartType: "composition_shift",
        totalBalance: Math.round(totalBalance),
        currentAllocationPct: currentPct,
        targetAllocationPct: targetAllocation,
        targetAllocationUSD: targetUSD,
        rebalanceDeltasUSD: deltas,
        dataSource: "live",
        message: `Diversification simulation: rebalance $${Math.round(totalBalance).toLocaleString()} treasury to ${summary}.`,
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
      totalBalance: Math.round(totalBalance),
      dataSource: "live",
      message: `Custom simulation: ${scenario}. Rendering visualization with current treasury of $${Math.round(totalBalance).toLocaleString()}.`,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// risk_assessment — concentration scoring from vaultState. Pure read.
// ─────────────────────────────────────────────────────────────────────────────
// SOL + liquid-staking derivatives all carry SOL price exposure → group them.
const SOL_FAMILY = new Set(["SOL", "WSOL", "MSOL", "JITOSOL", "BSOL", "STSOL", "JUPSOL", "INF"]);
const STABLECOINS = new Set(["USDC", "USDT", "DAI", "USDS", "PYUSD", "FDUSD", "USDH"]);
// Rough annualized vol bands used to weight concentration severity.
const VOL_BAND: Record<string, "stable" | "blue" | "alt" | "memecoin"> = {
  USDC: "stable", USDT: "stable", DAI: "stable", USDS: "stable", PYUSD: "stable", FDUSD: "stable", USDH: "stable",
  SOL: "blue", WSOL: "blue", MSOL: "blue", JITOSOL: "blue", BSOL: "blue", STSOL: "blue", JUPSOL: "blue", INF: "blue",
  ETH: "blue", BTC: "blue", JUP: "alt", JTO: "alt", RAY: "alt", ORCA: "alt", PYTH: "alt", MNDE: "alt",
  BONK: "memecoin", WIF: "memecoin", TRUMP: "memecoin",
};

function classifyAsset(symbol: string): { group: string; band: "stable" | "blue" | "alt" | "memecoin" } {
  const s = (symbol || "").toUpperCase();
  if (SOL_FAMILY.has(s)) return { group: "SOL+LSTs", band: "blue" };
  if (STABLECOINS.has(s)) return { group: "Stablecoins", band: "stable" };
  return { group: s, band: VOL_BAND[s] ?? "alt" };
}

const risk_assessment = defineCapability({
  id: "risk_assessment",
  domain: "intel",
  description:
    "Concentration & volatility-weighted risk assessment — groups SOL+LSTs and stablecoins by underlying exposure, applies dust-wallet guard, returns severity-tagged findings. Triggers Risk Radar visualization.",
  inputSchema: z.object({
    threshold: z
      .number()
      .optional()
      .default(40)
      .describe("Concentration threshold % to flag at the asset-group level (SOL+LSTs counted as one group)."),
    minNotionalUsd: z
      .number()
      .optional()
      .default(250)
      .describe("Skip concentration warnings if total treasury value is below this (dust-wallet guard)."),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async (input, ctx) => {
    const { threshold, minNotionalUsd } = input as {
      threshold: number;
      minNotionalUsd: number;
    };
    console.log(`[capability:risk_assessment] threshold=${threshold}% minNotional=$${minNotionalUsd}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const holdings: any[] = Array.isArray(ctx.vaultState?.tokens)
      ? (ctx.vaultState!.tokens as any[])
      : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokenValue = (t: any) => {
      const fromUsd =
        typeof t.usdValue === "number" && Number.isFinite(t.usdValue) ? t.usdValue : null;
      if (fromUsd != null) return fromUsd;
      return (Number(t.amount) || 0) * (Number(t.price) || 0);
    };
    const totalValue = holdings.reduce((sum, t) => sum + tokenValue(t), 0);

    // ── Dust-wallet guard ──────────────────────────────────────────────
    if (totalValue < minNotionalUsd) {
      return {
        success: true,
        operation: "risk_assessment",
        threshold,
        totalValue: Math.round(totalValue * 100) / 100,
        holdingsCount: holdings.length,
        findings: [
          {
            severity: "info" as const,
            code: "dust_wallet",
            message: `Treasury value $${totalValue.toFixed(2)} is below the $${minNotionalUsd} concentration-analysis floor. Connect a funded vault or pass a smaller minNotionalUsd to evaluate.`,
          },
        ],
        concentrationRisks: [],
        concentrations: [],
        groups: [],
        riskCount: 0,
        triggerVisualization: false,
        chartType: "risk_radar",
        message: `Treasury too small for meaningful concentration analysis ($${totalValue.toFixed(2)} < $${minNotionalUsd}).`,
      };
    }

    // ── Group by underlying exposure ──────────────────────────────────
    const groupMap = new Map<string, { group: string; value: number; band: "stable" | "blue" | "alt" | "memecoin"; members: string[] }>();
    for (const t of holdings) {
      const value = tokenValue(t);
      if (value <= 0) continue;
      const { group, band } = classifyAsset(t.symbol || "UNKNOWN");
      const existing = groupMap.get(group);
      if (existing) {
        existing.value += value;
        // worst-case band wins
        const rank = { stable: 0, blue: 1, alt: 2, memecoin: 3 } as const;
        if (rank[band] > rank[existing.band]) existing.band = band;
        if (t.symbol && !existing.members.includes(t.symbol)) existing.members.push(t.symbol);
      } else {
        groupMap.set(group, { group, value, band, members: t.symbol ? [t.symbol] : [] });
      }
    }
    const groups = Array.from(groupMap.values())
      .map((g) => ({ ...g, percentage: (g.value / totalValue) * 100 }))
      .sort((a, b) => b.percentage - a.percentage);

    // ── Volatility-weighted findings ──────────────────────────────────
    type Severity = "info" | "warn" | "high" | "critical";
    const findings: { severity: Severity; code: string; group: string; percentage: number; message: string }[] = [];

    for (const g of groups) {
      if (g.percentage < threshold) continue;
      // Stablecoin concentration is informational, not a warning.
      if (g.band === "stable") {
        findings.push({
          severity: "info",
          code: "stable_concentration",
          group: g.group,
          percentage: g.percentage,
          message: `${g.percentage.toFixed(1)}% in stablecoins — low market risk, but consider counterparty/issuer exposure (${g.members.join(", ")}).`,
        });
        continue;
      }
      // Severity scales by volatility band and how far above threshold.
      const overshoot = g.percentage - threshold;
      let severity: Severity = "warn";
      if (g.band === "memecoin") severity = g.percentage >= 50 ? "critical" : "high";
      else if (g.band === "alt") severity = g.percentage >= 70 ? "high" : "warn";
      else if (g.band === "blue") severity = g.percentage >= 80 ? "high" : g.percentage >= 60 ? "warn" : "info";
      void overshoot;
      findings.push({
        severity,
        code: `${g.band}_concentration`,
        group: g.group,
        percentage: g.percentage,
        message: `${g.percentage.toFixed(1)}% concentrated in ${g.group}${g.members.length > 1 ? ` (${g.members.join("+")})` : ""} — ${g.band} volatility band.`,
      });
    }

    // Diversification floor: warn if fewer than 2 groups carry >5%.
    const nonTrivial = groups.filter((g) => g.percentage > 5);
    if (nonTrivial.length === 1 && nonTrivial[0].band !== "stable") {
      findings.push({
        severity: "high",
        code: "single_asset_exposure",
        group: nonTrivial[0].group,
        percentage: nonTrivial[0].percentage,
        message: `Treasury is effectively a single-asset position in ${nonTrivial[0].group}. A drawdown in this asset = a drawdown in the treasury.`,
      });
    }

    const risks = findings.filter((f) => f.severity === "warn" || f.severity === "high" || f.severity === "critical");
    const worstSeverity: Severity = findings.reduce<Severity>((acc, f) => {
      const rank = { info: 0, warn: 1, high: 2, critical: 3 } as const;
      return rank[f.severity] > rank[acc] ? f.severity : acc;
    }, "info");

    return {
      success: true,
      operation: "risk_assessment",
      threshold,
      totalValue: Math.round(totalValue * 100) / 100,
      groups,
      concentrations: groups.map((g) => ({ token: g.group, value: g.value, percentage: g.percentage })),
      concentrationRisks: risks.map((r) => ({ token: r.group, percentage: r.percentage, severity: r.severity })),
      findings,
      riskCount: risks.length,
      worstSeverity,
      triggerVisualization: true,
      chartType: "risk_radar",
      message:
        risks.length > 0
          ? `${risks.length} concentration risk${risks.length === 1 ? "" : "s"} flagged (worst: ${worstSeverity}). Top group: ${groups[0]?.group} at ${groups[0]?.percentage.toFixed(1)}%.`
          : `No concentration risks above ${threshold}% after grouping SOL+LSTs and stablecoins. Top group: ${groups[0]?.group} at ${groups[0]?.percentage.toFixed(1)}%.`,
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
  description:
    "High-grade pre-flight & posture security audit. With a serialized transaction: runs SimulationFirewall on a mainnet fork + policy evaluation. Without one: fuses on-chain account inspection, treasury hygiene (multisig/signers), known-program reputation, and (when a wallet) token-approval surface. Returns severity-tagged findings, never a hardcoded 'pass'.",
  inputSchema: z.object({
    targetAddress: z.string().describe("Contract or wallet address to audit."),
    signer: z
      .string()
      .optional()
      .describe("Base58 pubkey of the intended signer when supplying a serialized transaction (distinct from the audited targetAddress)."),
    testType: z
      .enum(["posture", "preflight", "full"])
      .optional()
      .default("full")
      .describe("posture = read-only audit only; preflight = require serialized tx + simulation; full = both when inputs allow."),
    serializedTransaction: z
      .string()
      .optional()
      .describe("Optional base64-encoded transaction to simulate."),
  }),
  sideEffects: "sim",
  requiredAuth: "none",
  sensitivity: "medium",
  execute: async (input, ctx) => {
    const { targetAddress, testType, serializedTransaction, signer } = input as {
      targetAddress: string;
      testType: "posture" | "preflight" | "full";
      serializedTransaction?: string;
      signer?: string;
    };
    console.log(`[capability:security_firewall] ${testType} on ${targetAddress}`);

    type Severity = "info" | "warn" | "high" | "critical";
    const findings: { severity: Severity; code: string; message: string }[] = [];
    const checks: Record<string, "pass" | "warn" | "fail" | "skipped"> = {};
    const results: Record<string, unknown> = {};
    let simulated = false;

    // ─── 0. Validate address ────────────────────────────────────────────
    const { Connection, PublicKey } = await import("@solana/web3.js");
    let pubkey: InstanceType<typeof PublicKey> | null = null;
    try {
      pubkey = new PublicKey(targetAddress);
    } catch {
      return {
        success: false,
        operation: "security_firewall",
        targetAddress,
        testType,
        simulated: false,
        riskLevel: "CRITICAL" as const,
        worstSeverity: "critical" as const,
        findings: [{ severity: "critical", code: "invalid_address", message: `Not a valid Solana base58 address: ${targetAddress}` }],
        checks: { addressValid: "fail" },
        results: {},
        message: `Invalid Solana address — cannot audit.`,
      };
    }
    checks.addressValid = "pass";

    // ─── 1. On-chain inspection ─────────────────────────────────────────
    const conn = new Connection(ctx.rpcEndpoint, "confirmed");
    let accountInfo: Awaited<ReturnType<typeof conn.getAccountInfo>> = null;
    try {
      accountInfo = await conn.getAccountInfo(pubkey);
      checks.accountExists = accountInfo ? "pass" : "fail";
      results.accountExists = !!accountInfo;
      results.accountOwner = accountInfo?.owner?.toBase58() || null;
      results.accountLamports = accountInfo?.lamports || 0;
      results.isExecutable = accountInfo?.executable || false;
      if (!accountInfo) {
        findings.push({
          severity: "high",
          code: "account_missing",
          message: `Account ${targetAddress.slice(0, 12)}… does not exist on-chain. Transferring to it will burn SOL into a non-existent account.`,
        });
      }
    } catch (err) {
      checks.accountExists = "skipped";
      findings.push({
        severity: "warn",
        code: "rpc_error",
        message: `RPC inspection failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // ─── 2. Program reputation (when target is a program) ───────────────
    const KNOWN_PROGRAMS: Record<string, { name: string; trust: "high" | "medium" }> = {
      "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": { name: "Jupiter v6 Aggregator", trust: "high" },
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": { name: "Orca Whirlpools", trust: "high" },
      "MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhJBKbJ3K6V": { name: "Marinade Finance", trust: "high" },
      "Stake11111111111111111111111111111111111111": { name: "Solana Stake Program", trust: "high" },
      "ComputeBudget111111111111111111111111111111": { name: "Compute Budget", trust: "high" },
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": { name: "SPL Token", trust: "high" },
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": { name: "Associated Token Account", trust: "high" },
      "SqdsTwoB1xrEPbB1Y4xfwhWfYY7HRzGmRJK6BqXk5kf": { name: "Squads v4", trust: "high" },
    };
    if (accountInfo?.executable) {
      const rep = KNOWN_PROGRAMS[targetAddress];
      if (rep) {
        findings.push({
          severity: "info",
          code: "program_known",
          message: `Program is ${rep.name} (${rep.trust} trust).`,
        });
        checks.programReputation = "pass";
      } else {
        findings.push({
          severity: "warn",
          code: "program_unknown",
          message: `Program ${targetAddress.slice(0, 12)}… is not in our trusted registry. Verify the IDL and source before approving instructions.`,
        });
        checks.programReputation = "warn";
      }
    }

    // ─── 3. Wallet hygiene (treasury security audit) ────────────────────
    if (!accountInfo?.executable) {
      try {
        const base = process.env.NEXT_PUBLIC_APP_URL || "https://dreyv.com";
        const auditRes = await fetch(`${base}/api/treasury/security?wallet=${targetAddress}&public=1`, {
          method: "GET",
          signal: AbortSignal.timeout(8000),
        });
        if (auditRes.ok) {
          const { audit } = (await auditRes.json()) as {
            audit?: { score?: number; isMultisig?: boolean; findings?: { severity: string; code: string; message: string }[] };
          };
          if (audit) {
            results.hygieneScore = audit.score ?? null;
            results.isMultisig = !!audit.isMultisig;
            checks.walletHygiene = (audit.score ?? 0) >= 80 ? "pass" : (audit.score ?? 0) >= 60 ? "warn" : "fail";
            for (const f of audit.findings ?? []) {
              const sev: Severity = f.severity === "high" ? "high" : f.severity === "warn" ? "warn" : "info";
              findings.push({ severity: sev, code: `hygiene:${f.code}`, message: f.message });
            }
          }
        }
      } catch (err) {
        checks.walletHygiene = "skipped";
        console.warn("[security_firewall] hygiene audit skipped:", err);
      }

      // ─── 4. Token-approval surface (SPL delegated authority) ──────────
      try {
        const tokenAccounts = await conn.getParsedTokenAccountsByOwner(pubkey, {
          programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        });
        const delegated = tokenAccounts.value.filter((acc) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const info = (acc.account.data as any)?.parsed?.info;
          return info?.delegate && info?.delegatedAmount?.uiAmount > 0;
        });
        results.tokenAccountCount = tokenAccounts.value.length;
        results.delegatedApprovalCount = delegated.length;
        if (delegated.length === 0) {
          checks.tokenApprovals = "pass";
        } else {
          checks.tokenApprovals = delegated.length >= 3 ? "fail" : "warn";
          findings.push({
            severity: delegated.length >= 3 ? "high" : "warn",
            code: "delegated_approvals",
            message: `${delegated.length} token account(s) have a non-zero delegated authority. Revoke unused approvals — these are a common drain vector.`,
          });
        }
      } catch (err) {
        checks.tokenApprovals = "skipped";
        console.warn("[security_firewall] token-approval scan skipped:", err);
      }
    }

    // ─── 5. Pre-flight simulation (when transaction provided) ───────────
    if (testType === "preflight" && !serializedTransaction) {
      return {
        success: false,
        operation: "security_firewall",
        targetAddress,
        testType,
        simulated: false,
        riskLevel: "CRITICAL" as const,
        worstSeverity: "critical" as const,
        findings: [...findings, { severity: "critical", code: "preflight_missing_tx", message: "preflight testType requires a serializedTransaction." }],
        checks,
        results,
        message: "preflight requested but no serialized transaction supplied.",
      };
    }

    if (serializedTransaction) {
      const effectiveSigner = signer || targetAddress;
      try {
        const { SimulationFirewall } = await import("@/lib/studio/simulation-firewall");
        const firewall = SimulationFirewall.getInstance();
        const simResult = await firewall.simulate(serializedTransaction, effectiveSigner);
        simulated = true;
        results.simulationPassed = simResult.success;
        results.balanceChanges = simResult.balanceChanges;
        results.estimatedFee = simResult.estimatedFee;
        results.unitsConsumed = simResult.unitsConsumed;
        results.logs = simResult.logs.slice(0, 10);
        results.simRiskLevel = simResult.riskLevel;
        checks.simulation = simResult.success ? (simResult.riskLevel === "low" ? "pass" : "warn") : "fail";

        if (!simResult.success) {
          findings.push({
            severity: "critical",
            code: "sim_failed",
            message: `On-chain simulation failed: ${simResult.error || "unknown program error"}.`,
          });
        } else {
          const sevMap: Record<string, Severity> = { low: "info", medium: "warn", high: "high", critical: "critical" };
          findings.push({
            severity: sevMap[simResult.riskLevel] ?? "warn",
            code: "sim_risk",
            message: simResult.humanSummary,
          });
        }

        // Relative balance-discrepancy: 25% of largest absolute move OR > $500, whichever is greater.
        const moves = simResult.balanceChanges.map((c) => Math.abs(c.changeUsd || 0));
        const maxMove = moves.length ? Math.max(...moves) : 0;
        const discrepancyThreshold = Math.max(500, maxMove * 0.25);
        const discrepancy = simResult.balanceChanges.find((c) => Math.abs(c.changeUsd || 0) > discrepancyThreshold);
        if (discrepancy) {
          findings.push({
            severity: "warn",
            code: "balance_discrepancy",
            message: `Large balance move detected: ${discrepancy.token} ${discrepancy.change > 0 ? "+" : ""}${discrepancy.change.toFixed(4)} (~$${Math.abs(discrepancy.changeUsd || 0).toFixed(2)}).`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[capability:security_firewall] Simulation error:", msg);
        checks.simulation = "fail";
        findings.push({ severity: "critical", code: "sim_error", message: `Simulation pipeline error: ${msg}` });
        return {
          success: false,
          operation: "security_firewall",
          targetAddress,
          testType,
          simulated: false,
          riskLevel: "CRITICAL" as const,
          worstSeverity: "critical" as const,
          findings,
          checks,
          results,
          message: `Pre-flight simulation failed: ${msg}`,
        };
      }
    }

    // ─── 6. Worst severity & overall risk label ─────────────────────────
    const rank: Record<Severity, number> = { info: 0, warn: 1, high: 2, critical: 3 };
    const worstSeverity: Severity = findings.reduce<Severity>(
      (acc, f) => (rank[f.severity] > rank[acc] ? f.severity : acc),
      "info",
    );
    const riskLabel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" =
      worstSeverity === "critical" ? "CRITICAL" : worstSeverity === "high" ? "HIGH" : worstSeverity === "warn" ? "MEDIUM" : "LOW";
    const riskScore = { LOW: 0.15, MEDIUM: 0.45, HIGH: 0.75, CRITICAL: 0.95 }[riskLabel];

    const summary = simulated
      ? `Audit + simulation complete — ${riskLabel} (${findings.length} finding${findings.length === 1 ? "" : "s"}).`
      : `Posture audit complete — ${riskLabel} (${findings.length} finding${findings.length === 1 ? "" : "s"}). No transaction supplied, so on-chain simulation was skipped.`;

    return {
      success: true,
      operation: "security_firewall",
      targetAddress,
      signer: signer || null,
      testType,
      simulated,
      riskLevel: riskLabel,
      riskScore,
      worstSeverity,
      findings,
      checks,
      results,
      message: summary,
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
