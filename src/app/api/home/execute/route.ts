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

/**
 * Generic clarify card builder. Each item is a chip the UI renders.
 * Chip `action` semantics (handled by the frontend):
 *   - connect_wallet / enter_address / enter_sol / enter_usd / use_demo
 *     → drive the exposure flow (wallet sign-in or manual portfolio context)
 *   - apply_param  → directly set parameters on the next execute call
 *     (uses item.params object), no prompt
 *   - (no action)  → append item.reply (or item.symbol) to the original
 *     command and re-parse
 */
function buildClarify(opts: {
  forTool: string;
  question: string;
  title?: string;
  items: any[];
  extras?: Record<string, any>;
  source?: string;
}) {
  return {
    result_type: "clarify",
    title: opts.title || "Quick question",
    summary: opts.question,
    items: opts.items,
    meta: { source: opts.source || `Need a detail before I run ${opts.forTool}` },
    for_tool: opts.forTool,
    extras: opts.extras || {},
  } as any;
}

/**
 * Wallet/USD exposure chips — only for tools that genuinely need to model
 * a real treasury size (rebalance, what_if, find_airdrops with no input).
 */
function clarifyExposure(opts: {
  forTool: string;
  question: string;
  title?: string;
  extras?: Record<string, any>;
  includeDemo?: { label: string; value: any };
}) {
  const items: any[] = [
    { symbol: "Connect wallet", reply: "", action: "connect_wallet" },
    { symbol: "Paste a wallet address", reply: "", action: "enter_address" },
    { symbol: "Tell me your SOL holdings", reply: "", action: "enter_sol" },
    { symbol: "Enter a USD amount", reply: "", action: "enter_usd" },
  ];
  if (opts.includeDemo) {
    items.push({ symbol: opts.includeDemo.label, reply: "", action: "use_demo", demo_value: opts.includeDemo.value });
  }
  return buildClarify({
    forTool: opts.forTool,
    title: opts.title || "How should I model this?",
    question: opts.question,
    items,
    extras: opts.extras,
    source: `Need exposure context · will run ${opts.forTool}`,
  });
}

/**
 * Ask the LLM for 3-4 contextual chip suggestions tailored to the missing
 * parameter. Each chip carries `params` that the frontend will merge into
 * the next execute call via the `apply_param` action. Falls back to a
 * single "type a value" hint chip if the LLM is unavailable.
 */
async function suggestChips(args: {
  forTool: string;
  missing: string;            // e.g. "amount", "frequency", "targets", "token"
  context: string;            // human-readable description of what we already know
  paramKey: string;           // which key on the next params object to fill
  paramType: "number" | "string" | "object";
  fallback: { label: string; value: any }[];
}): Promise<any[]> {
  const schema = {
    name: "suggest_chips",
    description: "Return 3-4 short chip suggestions for a missing command parameter.",
    parameters: {
      type: "object",
      properties: {
        chips: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short chip label (≤4 words)" },
              value: { description: "Concrete value to fill the missing parameter" },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["chips"],
    },
  };
  const out = await llmJson(
    `You are Dreyv's command-bar assistant. The user gave a command that is missing the "${args.missing}" parameter for the "${args.forTool}" tool. Suggest 3-4 SHORT, realistic chip options the user could pick to fill it. Values must be concrete and immediately usable (e.g. real SOL amounts a retail user would type, real cadences, real allocation splits). No fake assumptions. Tailor to the context.`,
    `Context: ${args.context}\nMissing parameter: ${args.missing} (${args.paramType})`,
    schema
  );
  const chips = Array.isArray(out?.chips) ? out.chips.slice(0, 4) : [];
  if (chips.length === 0) {
    return args.fallback.map((f) => ({
      symbol: f.label,
      reply: "",
      action: "apply_param",
      params: { [args.paramKey]: f.value },
    }));
  }
  return chips.map((c: any) => ({
    symbol: String(c.label).slice(0, 32),
    reply: "",
    action: "apply_param",
    params: { [args.paramKey]: c.value },
  }));
}

async function execute(origin: string, tool_id: string, p: any) {
  switch (tool_id) {
    case "swap_tokens": {
      const inSym = (p.input_token || "").toUpperCase();
      const outSym = (p.output_token || "").toUpperCase();
      const amount = Number(p.amount);

      if (!inSym || !outSym || !isFinite(amount) || amount <= 0) {
        const missing = !isFinite(amount) || amount <= 0 ? "amount" : !inSym ? "input_token" : "output_token";
        const items = await suggestChips({
          forTool: "swap_tokens",
          missing,
          context: `Swap ${inSym || "?"} → ${outSym || "?"}, amount=${isFinite(amount) ? amount : "missing"}. Suggest realistic ${missing} values a Solana retail user would actually pick.`,
          paramKey: missing === "amount" ? "amount" : missing,
          paramType: missing === "amount" ? "number" : "string",
          fallback:
            missing === "amount"
              ? [
                  { label: `0.5 ${inSym || "SOL"}`, value: 0.5 },
                  { label: `2 ${inSym || "SOL"}`, value: 2 },
                  { label: `10 ${inSym || "SOL"}`, value: 10 },
                ]
              : [
                  { label: "SOL", value: "SOL" },
                  { label: "USDC", value: "USDC" },
                  { label: "JUP", value: "JUP" },
                ],
        });
        return buildClarify({
          forTool: "swap_tokens",
          title: missing === "amount" ? `How much ${inSym || ""} to swap?` : "Which token?",
          question: `Pick one or type your own — I won't guess.`,
          items,
          extras: { input_token: inSym || undefined, output_token: outSym || undefined, amount: isFinite(amount) ? amount : undefined },
        });
      }

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
      const amount = Number(p.amount);

      if (!isFinite(amount) || amount <= 0) {
        const items = await suggestChips({
          forTool: "stake_sol",
          missing: "amount",
          context: `Stake SOL with ${provider}. Suggest realistic SOL amounts a retail user staking with ${provider} would pick (small starter, mid, large).`,
          paramKey: "amount",
          paramType: "number",
          fallback: [
            { label: "1 SOL", value: 1 },
            { label: "10 SOL", value: 10 },
            { label: "100 SOL", value: 100 },
          ],
        });
        return buildClarify({
          forTool: "stake_sol",
          title: `How much SOL to stake with ${provider[0].toUpperCase() + provider.slice(1)}?`,
          question: "Pick a size — I'll quote live APY against it.",
          items,
          extras: { provider },
        });
      }

      // Pull live APY from the in-app yield registry rather than hardcoding.
      let apy = 0;
      let apySource = "";
      try {
        const yr = await fetch(`${origin}/api/yield/registry?provider=${provider}`, { signal: AbortSignal.timeout(5000) });
        const yj = await yr.json().catch(() => ({}));
        apy = Number(yj?.apy ?? yj?.providers?.[provider]?.apy ?? 0);
        apySource = yj?.source || "yield-registry";
      } catch {}

      if (!apy || apy <= 0) {
        return {
          result_type: "error",
          title: `${provider[0].toUpperCase() + provider.slice(1)} APY unavailable`,
          summary: "Live APY feed is offline — I won't show you a fake number. Please retry shortly.",
        };
      }

      const yearly = (amount * apy) / 100;
      const solPrice = await getPrice(origin, "SOL");
      return {
        result_type: "stake",
        title: `Stake ${amount} SOL with ${provider[0].toUpperCase() + provider.slice(1)}`,
        summary: `≈ ${yearly.toFixed(3)} SOL/yr ${solPrice ? `($${(yearly * solPrice).toFixed(2)})` : ""} at ${apy}% APY`,
        metrics: [
          { label: "Provider", value: provider[0].toUpperCase() + provider.slice(1) },
          { label: "Live APY", value: `${apy}%`, tone: "good" },
          { label: "Receipt token", value: provider === "jito" ? "jitoSOL" : provider === "blazestake" ? "bSOL" : "mSOL" },
          { label: "Unstake window", value: provider === "marinade" ? "Instant via mSOL" : "Epoch (~2 days)" },
        ],
        primary_action: { label: "Sign in to stake", requires_auth: true, intent: "execute_stake" },
        meta: { source: `${provider} · live · ${apySource}` },
      };
    }

    case "rebalance": {
      const targets: Record<string, number> | null =
        p.targets && typeof p.targets === "object" && Object.keys(p.targets).length ? p.targets : null;
      const ctx = p.portfolio_context && typeof p.portfolio_context === "object" ? p.portfolio_context : null;

      if (!targets) {
        return clarifyExposure({
          forTool: "rebalance",
          title: "What target allocation?",
          question: `Tell me the target split — e.g. "60% SOL, 30% USDC, 10% JTO". I won't guess your strategy.`,
        });
      }

      if (!ctx) {
        return clarifyExposure({
          forTool: "rebalance",
          title: "How big is the treasury you're rebalancing?",
          question: `I need your real exposure to quote each leg through Jupiter. How should I model it?`,
          extras: { targets },
        });
      }

      const solPrice = (await getPrice(origin, "SOL")) || 0;
      if (!solPrice) {
        return { result_type: "error", title: "Live SOL price unavailable", summary: "Retry — I won't fake a price." };
      }

      let portfolioUsd = 0;
      let portfolioLabel = "";
      if (ctx.mode === "sol_amount") {
        const amt = Number(ctx.value) || 0;
        portfolioUsd = amt * solPrice;
        portfolioLabel = `${amt} SOL (≈ $${portfolioUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })})`;
      } else if (ctx.mode === "usd_amount") {
        portfolioUsd = Number(ctx.value) || 0;
        portfolioLabel = `$${portfolioUsd.toLocaleString()} AUM`;
      } else if (ctx.mode === "wallet") {
        return {
          result_type: "info",
          title: "Wallet rebalance needs sign-in",
          summary: `For privacy, I read on-chain balances of ${String(ctx.value).slice(0, 4)}…${String(ctx.value).slice(-4)} only after you sign in.`,
          primary_action: { label: "Sign in to load wallet", requires_auth: true, intent: "execute_rebalance" },
          meta: { source: "Privacy gate · sign-in required for live wallet read" },
        };
      } else if (ctx.mode === "demo") {
        portfolioUsd = Number(ctx.value) || 100_000;
        portfolioLabel = `Demo basket · $${portfolioUsd.toLocaleString()}`;
      }

      if (!portfolioUsd || portfolioUsd <= 0) {
        return clarifyExposure({
          forTool: "rebalance",
          title: "Need a portfolio size",
          question: "I couldn't read that exposure. Try again — connect a wallet, paste an address, or enter an amount.",
          extras: { targets },
        });
      }

      const legs: any[] = [];
      let totalImpact = 0;
      for (const [sym, pct] of Object.entries(targets)) {
        if (sym === "SOL") continue;
        const usdLeg = (portfolioUsd * Number(pct)) / 100;
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
          { label: "Portfolio", value: portfolioLabel },
          { label: "Total price impact", value: `${totalImpact.toFixed(2)}%`, tone: totalImpact > 1.5 ? "warn" : "good" },
          { label: "Est. gas", value: `~${(legs.length * 0.000565).toFixed(4)} SOL` },
        ],
        primary_action: { label: "Sign in to execute plan", requires_auth: true, intent: "execute_rebalance" },
        secondary_action: { label: "Save as strategy", requires_auth: true, intent: "save_strategy" },
        meta: { source: `Jupiter v6 · ${ctx.mode} · live quotes` },
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
      const sym = (p.token || "").toUpperCase();
      if (!sym) {
        return clarifyExposure({
          forTool: "audit_token",
          title: "Which token should I audit?",
          question: "Tell me a symbol or mint address — e.g. BONK, JUP, or a full mint.",
        });
      }
      const t = tok(sym);
      if (!t) return { result_type: "error", title: "Unknown token", summary: `No mint mapped for ${sym}. Paste a full mint address to audit it.` };
      try {
        const r = await fetch(`${origin}/api/solana/rug-check?mint=${t.mint}`, { signal: AbortSignal.timeout(8000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.riskScore == null) {
          return { result_type: "error", title: `Audit unavailable for ${sym}`, summary: "Live rug-check feed is offline — I won't fabricate a score. Retry shortly." };
        }
        return {
          result_type: "audit",
          title: `Audit · ${sym}`,
          summary: `${j.verdict || "Risk score"} · ${j.riskScore}/100`,
          metrics: [
            { label: "Risk score", value: `${j.riskScore}/100`, tone: j.riskScore > 60 ? "warn" : "good" },
            { label: "Social score", value: `${j.socialScore ?? "—"}/100` },
            { label: "Verdict", value: j.verdict || "—" },
          ],
          flags: j.flags || [],
          meta: { source: "Helius · live on-chain checks" },
        };
      } catch {
        return { result_type: "error", title: `Audit unavailable for ${sym}`, summary: "Live rug-check feed unreachable — retry shortly." };
      }
    }

    case "find_airdrops": {
      const wallet = String(p.wallet || "").trim();
      // No wallet → ask. We refuse to show "Airdrops you may qualify for" against thin air.
      if (!wallet) {
        return clarifyExposure({
          forTool: "find_airdrops",
          title: "Whose wallet should I scan?",
          question: "I match real on-chain activity against active airdrop programs — paste a Solana address or connect your wallet.",
        });
      }
      // Live wallet read is gated for privacy.
      return {
        result_type: "info",
        title: "Sign in to scan this wallet",
        summary: `For privacy, I read on-chain history of ${wallet.slice(0, 4)}…${wallet.slice(-4)} only after sign-in. You'll get a real, live match against every active program — no canned list.`,
        primary_action: { label: "Sign in to scan", requires_auth: true, intent: "scan_wallet" },
        meta: { source: "Privacy gate · live Helius scan after sign-in" },
      };
    }

    case "what_if": {
      const scenario = String(p.scenario || "");
      // Caller can pass an explicit portfolio context after a clarify round-trip.
      // Shape: { mode: "demo" | "sol_amount" | "usd_amount" | "wallet", value: string|number }
      const ctx = p.portfolio_context && typeof p.portfolio_context === "object" ? p.portfolio_context : null;

      // Pull live prices for the major Solana basket so any projection uses REAL market data.
      const basket = ["SOL", "USDC", "JUP", "JTO", "BONK", "WIF"];
      const prices = Object.fromEntries(
        await Promise.all(basket.map(async (s) => [s, await getPrice(origin, s)]))
      ) as Record<string, number | null>;
      const solPrice = prices.SOL || 0;

      // STEP 1 — if no portfolio context yet, ask the LLM to decide whether the
      // scenario already contains enough info, or whether we should clarify.
      if (!ctx) {
        const triage = await llmJson(
          `You are Dreyv's risk analyst triage. Given a "what-if" scenario, decide whether the user has supplied enough portfolio context to project a meaningful P/L. A scenario like "what if SOL drops 40% to my $50k SOL bag" is enough. A scenario like "what if SOL drops 40%" alone is NOT enough — we don't know how much SOL the user holds. If insufficient, return needs_clarify=true and a SHORT, friendly question.`,
          `Scenario: "${scenario}"`,
          {
            name: "triage_what_if",
            description: "Decide if we have enough portfolio context",
            parameters: {
              type: "object",
              properties: {
                needs_clarify: { type: "boolean" },
                reason: { type: "string" },
                question: { type: "string", description: "Short question to ask the user if needs_clarify is true" },
              },
              required: ["needs_clarify"],
            },
          }
        );

        if (!triage || triage.needs_clarify !== false) {
          const question =
            triage?.question ||
            `To project this accurately I need to know your exposure. How should I model your treasury?`;
          return {
            result_type: "clarify",
            title: "How should I model your treasury?",
            summary: question,
            // Each item carries a `reply` (free-text appended) and an optional `action` for special UX.
            items: [
              { symbol: "Connect wallet", reply: "", action: "connect_wallet" },
              { symbol: "Paste a wallet address", reply: "", action: "enter_address" },
              { symbol: "Tell me your SOL holdings", reply: "", action: "enter_sol" },
              { symbol: `Use demo basket ($250k · 55% SOL)`, reply: "use demo basket", action: "use_demo" },
            ],
            meta: { source: `Need exposure context · scenario: "${scenario}"` },
            scenario,
            for_tool: "what_if",
          } as any;
        }
      }

      // STEP 2 — project against the supplied (or demo) context.
      const portfolioDescription = (() => {
        if (!ctx) return `Demo basket: $250,000 AUM split 55% SOL, 25% USDC, 10% JTO, 5% JUP, 5% BONK.`;
        if (ctx.mode === "sol_amount") {
          const amt = Number(ctx.value) || 0;
          return `User-supplied: ${amt} SOL (≈ $${(amt * solPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })} at live SOL price). Treat as 100% SOL unless they said otherwise.`;
        }
        if (ctx.mode === "usd_amount") {
          return `User-supplied: $${Number(ctx.value).toLocaleString()} AUM. Use a typical Solana-native split (60% SOL, 30% USDC, 10% other) unless they said otherwise.`;
        }
        if (ctx.mode === "wallet") {
          return `User-supplied wallet address: ${ctx.value}. Live balance fetch is gated behind sign-in for privacy — note in the projection that we cannot read this wallet without auth, and avoid inventing a portfolio size.`;
        }
        return `Demo basket: $250,000 AUM split 55% SOL, 25% USDC, 10% JTO, 5% JUP, 5% BONK.`;
      })();

      const projection = await llmJson(
        `You are a senior crypto treasury risk analyst. Project the impact of the user's scenario on the EXPLICIT portfolio described. Use the LIVE prices provided. Be specific, never vague — use real numbers from the portfolio. Do NOT invent assets the user did not mention.`,
        `Scenario: "${scenario}"\n\nPortfolio: ${portfolioDescription}\n\nLive prices (USD): ${JSON.stringify(prices)}\n\nReturn a structured projection.`,
        {
          name: "project_scenario",
          description: "Structured what-if projection grounded in live prices and the user's actual exposure",
          parameters: {
            type: "object",
            properties: {
              headline_pnl_usd: { type: "number" },
              direction: { type: "string", enum: ["bull", "bear", "neutral"] },
              key_drivers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    value: { type: "string" },
                    tone: { type: "string", enum: ["good", "warn", "neutral"] },
                  },
                  required: ["label", "value"],
                },
              },
              second_order_effects: { type: "array", items: { type: "string" } },
              recommended_hedges: { type: "array", items: { type: "string" } },
              assumptions: { type: "array", items: { type: "string" } },
            },
            required: ["headline_pnl_usd", "direction", "key_drivers", "second_order_effects", "recommended_hedges", "assumptions"],
          },
        }
      );

      if (!projection) {
        return { result_type: "error", title: "Scenario engine unavailable", summary: "AI projection failed. Please retry." };
      }

      const pnl = Number(projection.headline_pnl_usd || 0);
      return {
        result_type: "what_if",
        title: `What-if · ${scenario}`,
        summary: `Projected P/L ≈ ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        metrics: (projection.key_drivers || []).slice(0, 6).map((d: any) => ({
          label: d.label,
          value: d.value,
          tone: d.tone === "neutral" ? undefined : d.tone,
        })),
        steps: [
          ...(projection.second_order_effects || []).map((e: string) => `Second-order: ${e}`),
          ...(projection.recommended_hedges || []).map((h: string) => `Hedge: ${h}`),
        ],
        flags: (projection.assumptions || []).map((a: string) => ({ message: `Assumption — ${a}` })),
        primary_action: { label: "Sign in to model my real treasury", requires_auth: true, intent: "open_foresight" },
        meta: { source: `Foresight · ${ctx ? `your input (${ctx.mode})` : "demo basket"} · live prices` },
      };
    }

    case "create_dca": {
      const amount = Number(p.amount);
      const freq = p.frequency || "";
      const inSym = (p.in_token || "").toUpperCase();
      const outSym = (p.out_token || "").toUpperCase();

      if (!isFinite(amount) || amount <= 0 || !freq || !inSym || !outSym) {
        return clarifyExposure({
          forTool: "create_dca",
          title: "Tell me your DCA parameters",
          question: `I won't guess your strategy. What amount, token pair, and cadence? e.g. "100 USDC into SOL weekly".`,
          extras: { in_token: inSym || "USDC", out_token: outSym || "SOL", frequency: freq || "weekly" },
        });
      }

      const ticks = freq === "daily" ? 365 : freq === "weekly" ? 52 : 12;
      let perTickOut = "—";
      let impact = "—";
      try {
        const q = await getQuote(origin, inSym, outSym, amount);
        perTickOut = `${q.outAmount.toFixed(6)} ${outSym}`;
        impact = `${q.priceImpact.toFixed(3)}%`;
      } catch {}
      return {
        result_type: "plan",
        title: `DCA bot · ${amount} ${inSym} → ${outSym} ${freq}`,
        summary: `${ticks} executions/yr · routed via Jupiter · per-tick fill ≈ ${perTickOut}`,
        metrics: [
          { label: "Per execution", value: `${amount} ${inSym}` },
          { label: "Per-tick fill", value: perTickOut },
          { label: "Tick price impact", value: impact },
          { label: "Annual deploy", value: `${(amount * ticks).toLocaleString()} ${inSym}` },
        ],
        primary_action: { label: "Sign in to deploy bot", requires_auth: true, intent: "deploy_dca" },
        meta: { source: "Jupiter v6 · live quote per tick" },
      };
    }

    case "build_mini_app": {
      const idea = String(p.idea || "Custom widget");
      const blueprint = await llmJson(
        `You are Dreyv's AI Architect. Given a one-line mini-app idea, produce a concrete build plan that a developer could ship in Dreyv Studio today using @dreyv/sdk hooks (useJupiterSwap, usePortfolio, useVault, useTokenPrice, useYieldOptimizer, useGaslessTx, useNotification, useStorage, useTurnkey). Be specific to the idea, not generic.`,
        `Idea: "${idea}"\n\nReturn the blueprint.`,
        {
          name: "mini_app_blueprint",
          description: "Concrete build plan for a Solana mini-app",
          parameters: {
            type: "object",
            properties: {
              one_liner: { type: "string" },
              sdk_hooks: { type: "array", items: { type: "string" } },
              steps: { type: "array", items: { type: "string" }, description: "4-6 concrete build steps" },
              risks: { type: "array", items: { type: "string" } },
            },
            required: ["one_liner", "sdk_hooks", "steps"],
          },
        }
      );
      if (!blueprint) {
        return { result_type: "error", title: "Architect offline", summary: "AI blueprint failed — retry." };
      }
      return {
        result_type: "plan",
        title: "Mini-app blueprint",
        summary: blueprint.one_liner,
        metrics: [{ label: "SDK hooks", value: (blueprint.sdk_hooks || []).slice(0, 4).join(", ") || "—" }],
        steps: blueprint.steps || [],
        flags: (blueprint.risks || []).map((r: string) => ({ message: r })),
        primary_action: { label: "Sign in to open Studio", requires_auth: true, intent: "open_studio" },
        meta: { source: "Dreyv Studio · AI Architect" },
      };
    }

    case "build_agent": {
      const kind = p.kind || "trading";
      const rules = String(p.rules || "");
      const blueprint = await llmJson(
        `You are Dreyv's Agent Coordinator. Given an agent kind and free-text rules, produce a concrete deployment plan: tools to bind (Jupiter swap, Marinade stake, MEV scan, rug check, Squads multisig, Glass Safety simulation), risk envelope, and a backtest design. Be specific to the rules — never generic.`,
        `Kind: ${kind}\nRules: "${rules}"`,
        {
          name: "agent_blueprint",
          description: "Concrete agent deployment blueprint",
          parameters: {
            type: "object",
            properties: {
              one_liner: { type: "string" },
              bound_tools: { type: "array", items: { type: "string" } },
              risk_envelope: {
                type: "array",
                items: {
                  type: "object",
                  properties: { label: { type: "string" }, value: { type: "string" } },
                  required: ["label", "value"],
                },
              },
              steps: { type: "array", items: { type: "string" } },
            },
            required: ["one_liner", "bound_tools", "risk_envelope", "steps"],
          },
        }
      );
      if (!blueprint) {
        return { result_type: "error", title: "Coordinator offline", summary: "AI blueprint failed — retry." };
      }
      return {
        result_type: "plan",
        title: `${kind[0].toUpperCase() + kind.slice(1)} agent blueprint`,
        summary: blueprint.one_liner,
        metrics: (blueprint.risk_envelope || []).slice(0, 4),
        steps: blueprint.steps || [],
        flags: (blueprint.bound_tools || []).map((t: string) => ({ message: `Tool — ${t}` })),
        primary_action: { label: "Sign in to deploy agent", requires_auth: true, intent: "deploy_agent" },
        meta: { source: "Agent Coordinator · v2" },
      };
    }

    case "clarify": {
      // Parser determined we need a follow-up before we can simulate. Pure pass-through.
      return {
        result_type: "clarify",
        title: "Quick question",
        summary: String(p.question || "Could you give me a bit more detail?"),
        items: (p.suggested_replies || []).map((r: string) => ({ symbol: r, name: "" })),
        meta: { source: `Need a detail before I run ${p.for_tool || "this"}` },
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
