import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starter prompts = Dreyv's first-glance analysis of the active treasury.
 *
 * Flow: caller passes ?address=<vault-or-wallet>. We pull a thin slice of
 * holdings + recent activity from Helius, hand the summary to Lovable AI,
 * and the model returns:
 *   { insight: "<one human sentence about what it noticed>",
 *     prompts: [ { label, text, pillar } x 5 ] }
 *
 * Without an address we still return 5 prompts but with insight=null so the
 * UI shows the generic empty-state header. Never fabricate numbers — if data
 * is missing, the model is told to say so.
 */

const SYSTEM_PROMPT = `You are Dreyv (pronounced "DRAVE"), a Solana treasury copilot. Voice: calm, precise, founder-to-founder. No emoji, no hype words ("revolutionize", "supercharge", "game-changer", "next-gen").

You are looking at a real treasury snapshot. Your job:
1. Write ONE sentence ("insight") describing the single most useful thing you notice. Prefer recent activity specifics when present (e.g. "You swapped 200 SOL → USDC on JUPITER 3 days ago — 12.4k now sitting idle."). Use real numbers from the snapshot when you have them. If the snapshot is empty/zero, say so plainly ("Nothing on-chain here yet — connect a vault and I'll generate a real to-do list."). Never invent figures.
2. Generate 5 to-dos ("prompts") tailored to what you saw. Each prompt MUST be a curiosity-driven, monetary-hook to-do — earn more or save more. Bias hard towards: identify yield opportunities, analyze historical fees/slippage, build APR-targeted strategies, surface DCA opportunities, audit wallet risk. Cover at least one of each pillar: fees, yield, risk. Keep prompts 6-14 words, no trailing punctuation.

STRICT JSON only:
{
  "insight": "<one sentence or null>",
  "prompts": [ { "label": "<2-4 word verb phrase>", "text": "<full prompt>", "pillar": "fees" | "yield" | "risk" } ]
}
Exactly 5 prompts. Vary phrasing. Never repeat label across the 5.`;

const CURATED_FALLBACK_PROMPTS = [
  { label: "Find yield", text: "Identify yield opportunities for my idle stablecoins", pillar: "yield" as const },
  { label: "Audit fees", text: "Analyze fees I've paid in the last year and suggest savings", pillar: "fees" as const },
  { label: "Target APR", text: "Create a rebalancing strategy targeting 10% APR with medium risk", pillar: "yield" as const },
  { label: "DCA windows", text: "Show me DCA opportunities based on today's SOL drawdown", pillar: "yield" as const },
  { label: "Risk audit", text: "Audit my wallet for security risks and concentration exposure", pillar: "risk" as const },
];

interface Snapshot {
  address: string | null;
  totalUsd: number | null;
  holdings: Array<{ symbol: string; amount: number | null; usd: number | null; pct: number | null }>;
  idleStableUsd: number | null;
  idleStableAmount: number | null;
  recentSwaps: Array<{
    kind: string;
    fromSymbol?: string;
    toSymbol?: string;
    fromAmount?: number;
    toAmount?: number;
    whenHours: number;
    source?: string;
  }>;
  empty: boolean;
}

// Common Solana mints → symbol (cheap lookup before falling back to "?")
const MINT_SYMBOLS: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": "WETH",
  "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4": "JLP",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
};
function symFromMint(mint?: string | null): string | undefined {
  if (!mint) return undefined;
  return MINT_SYMBOLS[mint] || `${mint.slice(0, 4)}…`;
}

async function buildSnapshot(address: string | null, origin: string): Promise<Snapshot> {
  const empty: Snapshot = {
    address,
    totalUsd: null,
    holdings: [],
    idleStableUsd: null,
    idleStableAmount: null,
    recentSwaps: [],
    empty: true,
  };
  if (!address) return empty;

  // Holdings — keep rows even when no price is available so the LLM can still
  // see "5 SOL + 1.2k USDC" instead of an empty list.
  let holdings: Snapshot["holdings"] = [];
  let totalUsd = 0;
  let idleStableUsd = 0;
  let idleStableAmount = 0;
  let rawCount = 0;
  try {
    const r = await fetch(`${origin}/api/helius/das/wallet-holdings?address=${address}&limit=50`, { cache: "no-store" });
    if (r.ok) {
      const data = await r.json();
      const items: any[] = data?.holdings || data?.items || data?.tokens || [];
      const rows = items
        .map((it) => {
          const symRaw = String(it.symbol || it.token_info?.symbol || symFromMint(it.mint || it.id) || "?");
          const symbol = symRaw.toUpperCase();
          const decimals = Number(it.decimals ?? it.token_info?.decimals ?? 0);
          const amount = Number(it.amount ?? it.balance ?? 0) / Math.pow(10, decimals || 0);
          const price = Number(it.price ?? it.token_info?.price_info?.price_per_token ?? 0);
          const usd = price > 0 ? amount * price : null;
          return { symbol, amount: Number.isFinite(amount) ? amount : 0, usd };
        })
        .filter((h) => h.symbol && h.symbol !== "?" && h.amount > 0);
      rawCount = rows.length;
      totalUsd = rows.reduce((s, h) => s + (h.usd || 0), 0);
      const STABLES = new Set(["USDC", "USDT", "PYUSD", "USDS", "DAI", "USDH"]);
      const stableRows = rows.filter((h) => STABLES.has(h.symbol));
      idleStableUsd = stableRows.reduce((s, h) => s + (h.usd || 0), 0);
      idleStableAmount = stableRows.reduce((s, h) => s + h.amount, 0);
      holdings = rows
        .sort((a, b) => (b.usd || 0) - (a.usd || 0) || b.amount - a.amount)
        .slice(0, 6)
        .map((h) => ({
          symbol: h.symbol,
          amount: Number(h.amount.toFixed(4)),
          usd: h.usd,
          pct: totalUsd > 0 && h.usd ? Math.round((h.usd / totalUsd) * 100) : null,
        }));
    }
  } catch {}

  // Recent activity (last few parsed tx)
  let recentSwaps: Snapshot["recentSwaps"] = [];
  try {
    const r = await fetch(`${origin}/api/helius/addresses/${address}/transactions?limit=15`, { cache: "no-store" });
    if (r.ok) {
      const data = await r.json();
      const items: any[] = data?.items || data?.transactions || [];
      const now = Date.now() / 1000;
      recentSwaps = items
        .map((tx) => {
          const ts = Number(tx.timestamp || 0);
          const whenHours = ts > 0 ? Math.round((now - ts) / 3600) : 0;
          const kind = String(tx.type || "tx").toUpperCase();
          const source = tx.source ? String(tx.source).toUpperCase() : undefined;

          // Helius enriched: tokenTransfers carry mint + amount + accounts
          const transfers: any[] = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
          let fromSymbol: string | undefined;
          let toSymbol: string | undefined;
          let fromAmount: number | undefined;
          let toAmount: number | undefined;

          if (kind === "SWAP" && transfers.length >= 2) {
            const out = transfers.find((t) => t.fromUserAccount === address);
            const inc = transfers.find((t) => t.toUserAccount === address);
            if (out) { fromSymbol = symFromMint(out.mint); fromAmount = Number(out.tokenAmount || 0) || undefined; }
            if (inc) { toSymbol = symFromMint(inc.mint); toAmount = Number(inc.tokenAmount || 0) || undefined; }
          } else if (transfers.length >= 1) {
            const t0 = transfers[0];
            const isOut = t0.fromUserAccount === address;
            const sym = symFromMint(t0.mint);
            const amt = Number(t0.tokenAmount || 0) || undefined;
            if (isOut) { fromSymbol = sym; fromAmount = amt; }
            else { toSymbol = sym; toAmount = amt; }
          }

          return { kind, whenHours, source, fromSymbol, toSymbol, fromAmount, toAmount };
        })
        .filter((t) => /SWAP|TRANSFER|STAKE|UNSTAKE|DEPOSIT|WITHDRAW/.test(t.kind))
        .slice(0, 5);
    }
  } catch {}

  const isEmpty = totalUsd === 0 && holdings.length === 0 && recentSwaps.length === 0;
  return {
    address,
    totalUsd: totalUsd > 0 ? Math.round(totalUsd) : null,
    holdings,
    idleStableUsd: idleStableUsd > 0 ? Math.round(idleStableUsd) : null,
    idleStableAmount: idleStableAmount > 0 ? Number(idleStableAmount.toFixed(2)) : null,
    recentSwaps,
    empty: isEmpty,
  };
}

export async function GET(req: NextRequest) {
  const lovableUrl = process.env.LOVABLE_SUPABASE_URL || process.env.LOVABLE_AI_PROXY_SUPABASE_URL;
  const lovableAnon = process.env.LOVABLE_SUPABASE_ANON_KEY || process.env.LOVABLE_SUPABASE_PUBLISHABLE_KEY;
  const proxyUrlExplicit = process.env.LOVABLE_AI_PROXY_URL;
  const supabaseUrl =
    lovableUrl || (!proxyUrlExplicit ? process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL : undefined);
  const supabaseAnon =
    lovableAnon ||
    (!proxyUrlExplicit
      ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env.SUPABASE_ANON_KEY
      : undefined);
  const proxyUrl = proxyUrlExplicit
    ? proxyUrlExplicit.replace(/\/+$/, "")
    : supabaseUrl
    ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/lovable-ai-proxy`
    : null;

  if (!proxyUrl || !supabaseAnon) {
    return Response.json(
      {
        insight: null,
        prompts: CURATED_FALLBACK_PROMPTS,
        analyzed: false,
        snapshot: null,
        fallback: "ai_gateway_not_configured",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { searchParams, origin } = new URL(req.url);
  const rawAddress = searchParams.get("address")?.trim() || null;
  const address = rawAddress && rawAddress.length >= 32 && rawAddress.length <= 64 ? rawAddress : null;

  const snapshot = await buildSnapshot(address, origin);
  const seed = Math.random().toString(36).slice(2, 8);

  const userMsg = address
    ? `Treasury snapshot (variation seed ${seed}):\n${JSON.stringify(snapshot, null, 2)}\n\nAnalyze and return the JSON.`
    : `No treasury connected yet (variation seed ${seed}). Set "insight" to null and return 5 generic-but-useful starter to-dos covering fees, yield, and risk.`;

  const upstream = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseAnon}`,
      apikey: supabaseAnon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      stream: false,
      temperature: address ? 0.55 : 0.9,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!upstream.ok) {
    return Response.json(
      { insight: null, prompts: CURATED_FALLBACK_PROMPTS, analyzed: false, snapshot: null, fallback: "ai_gateway_error" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const data = (await upstream.json().catch(() => null)) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return Response.json(
      { insight: null, prompts: CURATED_FALLBACK_PROMPTS, analyzed: false, snapshot: null, fallback: "no_content" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  let parsed: any;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return Response.json(
      { insight: null, prompts: CURATED_FALLBACK_PROMPTS, analyzed: false, snapshot: null, fallback: "parse_error" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts.slice(0, 5) : [];
  const insight = typeof parsed?.insight === "string" && parsed.insight.trim() ? parsed.insight.trim() : null;
  if (prompts.length === 0) {
    return Response.json(
      { insight, prompts: CURATED_FALLBACK_PROMPTS, analyzed: Boolean(address), snapshot: null, fallback: "empty_prompts" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      insight,
      prompts,
      analyzed: Boolean(address),
      snapshot: address ? { totalUsd: snapshot.totalUsd, idleStableUsd: snapshot.idleStableUsd, empty: snapshot.empty } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
