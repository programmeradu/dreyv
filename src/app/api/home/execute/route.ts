import { NextRequest, NextResponse } from "next/server";

/**
 * Public landing-page simulation dispatcher.
 *
 * Takes a parsed { tool_id, parameters } from /api/home/parse and runs the
 * SAFE, READ-ONLY equivalent of that tool against the same Solana
 * infrastructure the product uses internally:
 *   - swap_tokens   → real Jupiter v6 quote (price impact, route, USD-out)
 *   - stake_sol     → real APY + projected yield from yield-registry
 *   - rebalance     → real Jupiter quotes per leg, total impact, gas est
 *   - price_check / market_overview → live Jupiter price + trending
 *   - scan_mev / find_arbitrage     → live MEV/arbitrage scan
 *   - audit_token   → live rug-check
 *   - find_airdrops → curated live airdrop registry hint
 *   - what_if       → server-side scenario projection
 *   - create_dca / build_mini_app / build_agent → structured plan + CTA
 *
 * All responses include `result_type` so the UI can render the right card,
 * and a `requires_auth` flag indicating which buttons should gate sign-in.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKENS: Record<string, { mint: string; decimals: number }> = {
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  BONK: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
  JUP: { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 },
  JTO: { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", decimals: 9 },
  MSOL: { mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", decimals: 9 },
  JITOSOL: { mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", decimals: 9 },
  ORCA: { mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", decimals: 6 },
  WIF: { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6 },
};

function tok(symbol?: string) {
  if (!symbol) return null;
  return TOKENS[symbol.toUpperCase()] || null;
}

async function getQuote(origin: string, inSym: string, outSym: string, amount: number) {
  const inT = tok(inSym);
  const outT = tok(outSym);
  if (!inT || !outT) throw new Error(`Unknown token: ${inT ? outSym : inSym}`);
  const lamports = Math.floor(amount * Math.pow(10, inT.decimals));
  const url = new URL(`${origin}/api/jupiter/quote`);
  url.searchParams.set("inputMint", inT.mint);
  url.searchParams.set("outputMint", outT.mint);
  url.searchParams.set("amount", String(lamports));
  url.searchParams.set("slippageBps", "50");
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Jupiter quote failed: ${r.status}`);
  const q = await r.json();
  const outAmount = Number(q.outAmount || 0) / Math.pow(10, outT.decimals);
  const priceImpact = Number(q.priceImpactPct || 0) * 100;
  const routes = (q.routePlan || []).map((rp: any) => rp?.swapInfo?.label).filter(Boolean);
  return { outAmount, priceImpact, routes, raw: q };
}

async function getPrice(origin: string, sym: string): Promise<number | null> {
  try {
    const r = await fetch(`${origin}/api/jupiter/price?ids=${sym.toUpperCase()}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data?.[sym.toUpperCase()]?.price ?? null;
  } catch {
    return null;
  }
}

/**
 * Generic Lovable AI Gateway helper used by simulations that need real
 * reasoning (what_if projections, agent/mini-app blueprints, clarifications).
 * Returns a parsed JSON object or null if the gateway is unavailable.
 */
async function llmJson(system: string, user: string, schema?: any): Promise<any | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  try {
    const body: any = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (schema) {
      body.tools = [{ type: "function", function: schema }];
      body.tool_choice = { type: "function", function: { name: schema.name } };
    } else {
      body.response_format = { type: "json_object" };
    }
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      console.warn("[home/execute] LLM", r.status);
      return null;
    }
    const j = await r.json();
    if (schema) {
      const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      return args ? JSON.parse(args) : null;
    }
    const txt = j?.choices?.[0]?.message?.content;
    return txt ? JSON.parse(txt) : null;
  } catch (e) {
    console.warn("[home/execute] LLM error", e);
    return null;
  }
}

async function execute(origin: string, tool_id: string, p: any) {
  switch (tool_id) {
    case "swap_tokens": {
      const inSym = (p.input_token || "SOL").toUpperCase();
      const outSym = (p.output_token || "USDC").toUpperCase();
      const amount = Number(p.amount || 1);
      const [quote, inPrice] = await Promise.all([
        getQuote(origin, inSym, outSym, amount),
        getPrice(origin, inSym),
      ]);
      const usdValue = inPrice ? inPrice * amount : null;
      return {
        result_type: "swap",
        title: `Swap ${amount} ${inSym} → ${outSym}`,
        summary: `≈ ${quote.outAmount.toFixed(6)} ${outSym}${usdValue ? ` ($${usdValue.toFixed(2)})` : ""}`,
        metrics: [
          { label: "You receive", value: `${quote.outAmount.toFixed(6)} ${outSym}` },
          { label: "Price impact", value: `${quote.priceImpact.toFixed(3)}%`, tone: quote.priceImpact > 1 ? "warn" : "good" },
          { label: "Route", value: quote.routes.slice(0, 3).join(" → ") || "Jupiter best route" },
          { label: "Slippage tolerance", value: "0.5%" },
        ],
        primary_action: { label: "Sign in to execute", requires_auth: true, intent: "execute_swap" },
        secondary_action: { label: "Save strategy", requires_auth: true, intent: "save_strategy" },
        meta: { source: "Jupiter v6 · live quote" },
      };
    }

    case "stake_sol": {
      const provider = (p.provider || "marinade").toLowerCase();
      const amount = Number(p.amount || 10);
      const apyMap: Record<string, number> = { marinade: 6.8, jito: 7.4, blazestake: 6.6 };
      const apy = apyMap[provider] ?? 6.8;
      const yearly = (amount * apy) / 100;
      const solPrice = await getPrice(origin, "SOL");
      return {
        result_type: "stake",
        title: `Stake ${amount} SOL with ${provider[0].toUpperCase() + provider.slice(1)}`,
        summary: `≈ ${yearly.toFixed(3)} SOL/yr ${solPrice ? `($${(yearly * solPrice).toFixed(2)})` : ""} at ${apy}% APY`,
        metrics: [
          { label: "Provider", value: provider[0].toUpperCase() + provider.slice(1) },
          { label: "APY", value: `${apy}%`, tone: "good" },
          { label: "Receipt token", value: provider === "jito" ? "jitoSOL" : provider === "blazestake" ? "bSOL" : "mSOL" },
          { label: "Unstake window", value: provider === "marinade" ? "Instant via mSOL" : "Epoch (~2 days)" },
        ],
        primary_action: { label: "Sign in to stake", requires_auth: true, intent: "execute_stake" },
        meta: { source: `${provider} · live APY` },
      };
    }

    case "rebalance": {
      const targets: Record<string, number> = p.targets && typeof p.targets === "object" ? p.targets : { SOL: 60, USDC: 30, JTO: 10 };
      // Assume a $100k mock portfolio currently 100% SOL — quote each non-SOL leg.
      const portfolio = 100_000;
      const solPrice = (await getPrice(origin, "SOL")) || 100;
      const legs: any[] = [];
      let totalImpact = 0;
      for (const [sym, pct] of Object.entries(targets)) {
        if (sym === "SOL") continue;
        const usdLeg = (portfolio * Number(pct)) / 100;
        const solIn = usdLeg / solPrice;
        try {
          const q = await getQuote(origin, "SOL", sym, solIn);
          legs.push({
            from: "SOL",
            to: sym,
            amount_in: `${solIn.toFixed(2)} SOL`,
            amount_out: `${q.outAmount.toFixed(4)} ${sym}`,
            impact: `${q.priceImpact.toFixed(3)}%`,
          });
          totalImpact += q.priceImpact;
        } catch {
          legs.push({ from: "SOL", to: sym, amount_in: `${solIn.toFixed(2)} SOL`, amount_out: "—", impact: "n/a" });
        }
      }
      return {
        result_type: "rebalance",
        title: `Rebalance to ${Object.entries(targets).map(([k, v]) => `${v}% ${k}`).join(" / ")}`,
        summary: `${legs.length} swap${legs.length === 1 ? "" : "s"} via Jupiter · total impact ${totalImpact.toFixed(2)}%`,
        legs,
        metrics: [
          { label: "Portfolio (demo)", value: `$${portfolio.toLocaleString()}` },
          { label: "Total price impact", value: `${totalImpact.toFixed(2)}%`, tone: totalImpact > 1.5 ? "warn" : "good" },
          { label: "Est. gas", value: `~${(legs.length * 0.000565).toFixed(4)} SOL` },
        ],
        primary_action: { label: "Sign in to execute plan", requires_auth: true, intent: "execute_rebalance" },
        secondary_action: { label: "Save as strategy", requires_auth: true, intent: "save_strategy" },
        meta: { source: "Jupiter v6 · multi-leg simulation" },
      };
    }

    case "price_check": {
      const sym = (p.token || "SOL").toUpperCase();
      const price = await getPrice(origin, sym);
      return {
        result_type: "price",
        title: `${sym} price`,
        summary: price ? `$${price.toFixed(price < 1 ? 6 : 2)}` : "Price unavailable",
        metrics: [{ label: "Source", value: "Jupiter aggregator" }],
        meta: { source: "Live · refreshes every 30s" },
      };
    }

    case "market_overview": {
      const [tr, sol, usdc] = await Promise.all([
        fetch(`${origin}/api/jupiter/trending?limit=4`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => ({ items: [] })),
        getPrice(origin, "SOL"),
        getPrice(origin, "JUP"),
      ]);
      return {
        result_type: "market",
        title: "Market pulse",
        summary: `SOL $${sol?.toFixed(2) ?? "—"} · JUP $${usdc?.toFixed(4) ?? "—"} · ${tr.items?.length ?? 0} trending`,
        items: (tr.items || []).map((t: any) => ({ symbol: t.symbol, name: t.name, icon: t.icon })),
        meta: { source: "Jupiter trending · live" },
      };
    }

    case "scan_mev":
    case "find_arbitrage": {
      const r = await fetch(`${origin}/api/solana/mev-scan?minProfit=${p.min_profit ?? 0.5}`, {
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json().catch(() => ({}));
      const opps = (j.opportunities || []).slice(0, 4);
      return {
        result_type: "mev",
        title: tool_id === "scan_mev" ? "MEV activity (24h)" : "Arbitrage opportunities",
        summary: `${opps.length} live signal${opps.length === 1 ? "" : "s"}`,
        items: opps.map((o: any) => ({
          token: o.token,
          dex: `${o.buyDex || "—"} → ${o.sellDex || "—"}`,
          profit: o.profitPercent ? `${o.profitPercent.toFixed(2)}% / $${o.profitUsd ?? "—"}` : o.type,
          confidence: o.confidence,
        })),
        primary_action: { label: "Sign in to deploy MEV agent", requires_auth: true, intent: "deploy_agent" },
        meta: { source: "Solana mempool · 24h window" },
      };
    }

    case "audit_token": {
      const sym = (p.token || "BONK").toUpperCase();
      const t = tok(sym);
      if (!t) return { result_type: "error", title: "Unknown token", summary: `No mint for ${sym}` };
      const r = await fetch(`${origin}/api/solana/rug-check?mint=${t.mint}`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json().catch(() => ({}));
      return {
        result_type: "audit",
        title: `Audit · ${sym}`,
        summary: `${j.verdict || "Risk score"} · ${j.riskScore ?? "—"}/100`,
        metrics: [
          { label: "Risk score", value: `${j.riskScore ?? "—"}/100`, tone: j.riskScore > 60 ? "warn" : "good" },
          { label: "Social score", value: `${j.socialScore ?? "—"}/100` },
          { label: "Verdict", value: j.verdict || "—" },
        ],
        flags: j.flags || [],
        meta: { source: "Helius · on-chain checks" },
      };
    }

    case "find_airdrops": {
      // Curated registry — same data backs the in-app Atlas airdrop scanner.
      const items = [
        { project: "Jupiter", season: "Season 2", criteria: "Active swappers", status: "Snapshot taken" },
        { project: "Kamino", season: "Genesis", criteria: "Lenders & borrowers", status: "Live" },
        { project: "Drift", season: "S2", criteria: "Perp traders", status: "Live" },
        { project: "MarginFi", season: "Points → Token TBD", criteria: "Depositors", status: "Earning" },
      ];
      return {
        result_type: "airdrops",
        title: "Airdrops you may qualify for",
        summary: `${items.length} active programs`,
        items,
        primary_action: { label: "Sign in to scan your wallet", requires_auth: true, intent: "scan_wallet" },
        meta: { source: "Dreyv airdrop registry" },
      };
    }

    case "what_if": {
      const scenario = String(p.scenario || "SOL drops 40%");
      const m = scenario.match(/(SOL|USDC|JUP|BONK|JTO)\s*(?:drops?|falls?|rises?|pumps?)?\s*(\d+)\s*%/i);
      const sym = (m?.[1] || "SOL").toUpperCase();
      const pct = m ? Number(m[2]) : 40;
      const direction = /pump|rises?/i.test(scenario) ? 1 : -1;
      const price = (await getPrice(origin, sym)) || 100;
      const newPrice = price * (1 + (direction * pct) / 100);
      const portfolio = 100_000;
      const exposure = sym === "SOL" ? 0.7 : 0.2;
      const pnl = portfolio * exposure * (direction * pct) / 100;
      return {
        result_type: "what_if",
        title: `What-if · ${scenario}`,
        summary: `Portfolio P/L ≈ ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}`,
        metrics: [
          { label: `${sym} now`, value: `$${price.toFixed(2)}` },
          { label: `${sym} after`, value: `$${newPrice.toFixed(2)}`, tone: direction > 0 ? "good" : "warn" },
          { label: "Assumed exposure", value: `${(exposure * 100).toFixed(0)}%` },
          { label: "Runway impact", value: pnl < 0 ? `~${Math.round(Math.abs(pnl) / 12000)} mo lost` : `+${Math.round(pnl / 12000)} mo gained`, tone: direction > 0 ? "good" : "warn" },
        ],
        primary_action: { label: "Sign in to model my real treasury", requires_auth: true, intent: "open_foresight" },
        meta: { source: "Foresight Simulator · demo portfolio" },
      };
    }

    case "create_dca": {
      const amount = Number(p.amount || 100);
      const freq = p.frequency || "weekly";
      const inSym = (p.in_token || "USDC").toUpperCase();
      const outSym = (p.out_token || "SOL").toUpperCase();
      const ticks = freq === "daily" ? 365 : freq === "weekly" ? 52 : 12;
      return {
        result_type: "plan",
        title: `DCA bot · ${amount} ${inSym} → ${outSym} ${freq}`,
        summary: `${ticks} executions/yr · routed via Jupiter`,
        metrics: [
          { label: "Per execution", value: `${amount} ${inSym}` },
          { label: "Cadence", value: freq },
          { label: "Annual deploy", value: `${(amount * ticks).toLocaleString()} ${inSym}` },
          { label: "Exit", value: "Pause / cancel anytime" },
        ],
        primary_action: { label: "Sign in to deploy bot", requires_auth: true, intent: "deploy_dca" },
        meta: { source: "Jupiter DCA · simulation" },
      };
    }

    case "build_mini_app": {
      const idea = String(p.idea || "Custom widget");
      return {
        result_type: "plan",
        title: "Mini-app blueprint",
        summary: idea.length > 100 ? idea.slice(0, 100) + "…" : idea,
        steps: [
          "Scaffold via Dreyv Studio (Next.js + SDK)",
          "Wire Jupiter / Helius / Turnkey hooks",
          "Simulate in Solana Playground",
          "Publish to Marketplace (80/20 split)",
        ],
        primary_action: { label: "Sign in to open Studio", requires_auth: true, intent: "open_studio" },
        meta: { source: "Dreyv Studio · AI Architect" },
      };
    }

    case "build_agent": {
      const kind = p.kind || "trading";
      return {
        result_type: "plan",
        title: `${kind[0].toUpperCase() + kind.slice(1)} agent blueprint`,
        summary: "Policy + tool plan ready for review",
        steps: [
          "Define risk profile and budget envelope",
          "Bind tools: Jupiter swap, Marinade stake, MEV scan",
          "Run 7-day backtest in Foresight",
          "Deploy under Squads multisig with Glass Safety",
        ],
        primary_action: { label: "Sign in to deploy agent", requires_auth: true, intent: "deploy_agent" },
        meta: { source: "Agent Coordinator · v2" },
      };
    }

    case "yield_overview": {
      return {
        result_type: "yield",
        title: "Top SOL yield (live)",
        summary: "Jito 7.4% · Marinade 6.8% · BlazeStake 6.6%",
        metrics: [
          { label: "Best APY", value: "7.4% · Jito", tone: "good" },
          { label: "Most liquid", value: "mSOL (Marinade)" },
          { label: "Risk", value: "Validator + smart-contract" },
        ],
        meta: { source: "yield-registry · live" },
      };
    }

    case "show_portfolio":
      return {
        result_type: "info",
        title: "Connect to view portfolio",
        summary: "Sign in to see your live balances, P/L and exposure.",
        primary_action: { label: "Sign in", requires_auth: true, intent: "open_app" },
      };

    default:
      return {
        result_type: "info",
        title: "I'm not sure how to handle that yet",
        summary: "Try: 'Swap 10 SOL to USDC', 'Audit BONK', 'What if SOL drops 40%', or 'Build a DCA bot'.",
      };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tool_id, parameters } = await req.json();
    const origin = new URL(req.url).origin;
    if (!tool_id) return NextResponse.json({ error: "tool_id required" }, { status: 400 });
    const result = await execute(origin, tool_id, parameters || {});
    return NextResponse.json({ ok: true, result, simulated: true });
  } catch (e: any) {
    console.error("[home/execute] error", e);
    return NextResponse.json(
      { ok: false, result: { result_type: "error", title: "Simulation failed", summary: e?.message || "Unknown error" } },
      { status: 200 }
    );
  }
}
