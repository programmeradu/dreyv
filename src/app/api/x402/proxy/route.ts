/**
 * POST /api/x402/proxy
 *
 * Universal x402 payment relay. Lets a Dreyv agent pay for ANY x402-protected
 * resource on the open web — not just Dreyv SKUs — using either:
 *
 *   - their prepaid Dreyv USDC balance (when the resource accepts a Dreyv-
 *     facilitated payment proof, or when `mode: "balance_only"`), or
 *   - their auto-provisioned custodial Solana wallet (real on-chain USDC
 *     settlement to the resource's `payTo` address).
 *
 * Lifecycle (deterministic, single-shot for the agent):
 *
 *   1. Forward the agent's request to the target URL.
 *   2. If status ≠ 402 → return the upstream response verbatim (passthrough).
 *   3. Parse the upstream 402 body for x402 `accepts[]`. Pick the cheapest
 *      Solana USDC quote that is ≤ `max_price_usd` (default 1.00 USDC).
 *   4. Settle on Solana from the agent's custodial wallet (SPL transfer +
 *      Solana Pay memo carrying the resource hash).
 *   5. Retry the request with `X-PAYMENT: <base64 payload>` and return the
 *      fulfilled response, plus a structured `payment` receipt.
 *
 * Auth: `Authorization: Bearer dk_live_…` or `dak_…`.
 *
 * Body:
 *   {
 *     url: string,                     // required
 *     method?: "GET"|"POST"|"PUT"|"PATCH"|"DELETE",
 *     headers?: Record<string,string>, // forwarded verbatim
 *     body?: unknown,                  // forwarded as JSON if object, raw if string
 *     max_price_usd?: number,          // hard cap (default 1.00)
 *     network?: "solana"|"solana-devnet", // hint; default mainnet
 *   }
 *
 * Responses:
 *   200 → { ok:true, upstream:{status,headers,body}, payment:{...receipt...} }
 *   402 → { ok:false, reason, accepts, advice }     // payment not possible
 *   413 → { ok:false, reason:"over_budget", quote, max_price_usd }
 *   502 → { ok:false, reason:"upstream_still_402_after_payment", ... }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";

import { resolveAgentKeyOrInternal } from "@/lib/agent/api-keys";
import {
  getOrCreateAgentWallet,
  getWalletBalances,
  payInvoiceFromAgentWallet,
  MIN_SOL_LAMPORTS_FOR_TX,
} from "@/lib/agent/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOLANA_USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const SAFE_NETWORKS = new Set(["solana", "solana-mainnet", "solana-devnet"]);
const MAX_BODY_BYTES = 256 * 1024; // upstream body cap we'll relay

const Body = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  max_price_usd: z.number().positive().max(50).default(1),
  network: z.string().optional(),
});

type X402Accept = {
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  maxAmountRequired?: string | number;
  resource?: string;
  description?: string;
  mimeType?: string;
  extra?: Record<string, unknown>;
};

function stripHopByHop(h: Record<string, string> | undefined): Record<string, string> {
  if (!h) return {};
  const banned = new Set([
    "host", "content-length", "connection", "keep-alive", "transfer-encoding",
    "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate",
    // never leak Dreyv auth upstream
    "authorization", "cookie",
  ]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (!banned.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

async function readBoundedBody(res: Response): Promise<{ text: string; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { truncated = true; break; }
      chunks.push(value);
    }
  }
  try { await reader.cancel(); } catch {}
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"), truncated };
}

function pickQuote(
  accepts: X402Accept[],
  maxPriceMinor: bigint,
  preferredNetwork: string | undefined,
): { quote: X402Accept; amountMinor: bigint } | { quote: X402Accept; over: true; amountMinor: bigint } | null {
  const solanaQuotes = accepts.filter((a) => {
    const net = (a.network || "").toLowerCase();
    if (!SAFE_NETWORKS.has(net)) return false;
    const asset = (a.asset || "").toLowerCase();
    // Accept either explicit USDC mint or the symbol-style declaration.
    return asset === SOLANA_USDC_MAINNET.toLowerCase() || asset.includes("usdc");
  });
  if (solanaQuotes.length === 0) return null;
  solanaQuotes.sort((a, b) => {
    if (preferredNetwork) {
      const ap = (a.network || "").toLowerCase() === preferredNetwork.toLowerCase() ? -1 : 0;
      const bp = (b.network || "").toLowerCase() === preferredNetwork.toLowerCase() ? -1 : 0;
      if (ap !== bp) return ap - bp;
    }
    const av = BigInt(String(a.maxAmountRequired ?? "0"));
    const bv = BigInt(String(b.maxAmountRequired ?? "0"));
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  const best = solanaQuotes[0];
  const amountMinor = BigInt(String(best.maxAmountRequired ?? "0"));
  if (amountMinor <= BigInt(0)) return null;
  if (amountMinor > maxPriceMinor) return { quote: best, over: true, amountMinor };
  return { quote: best, amountMinor };
}

function formatUsdc(minor: bigint): string {
  const base = BigInt(10) ** BigInt(USDC_DECIMALS);
  const whole = minor / base;
  const frac = minor % base;
  if (frac === BigInt(0)) return whole.toString();
  return `${whole}.${frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "")}`;
}

function resourceHash(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex").slice(0, 32);
}

export async function POST(req: NextRequest) {
  const key = await resolveAgentKeyOrInternal(req);
  if (!key) {
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "Provide Authorization: Bearer dk_live_… or dak_…",
        docs: "https://dreyv.com/auth.md",
      },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="dreyv-x402-proxy"' } },
    );
  }

  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { url, method, headers, body, max_price_usd, network } = parsed.data;

  const forwardHeaders = stripHopByHop(headers);
  forwardHeaders["accept"] = forwardHeaders["accept"] || "application/json, */*";
  forwardHeaders["user-agent"] = forwardHeaders["user-agent"] || "Dreyv-x402-proxy/1.0 (+https://dreyv.com)";

  const init: RequestInit = { method, headers: forwardHeaders, redirect: "follow" };
  if (body !== undefined && method !== "GET" && method !== "DELETE") {
    if (typeof body === "string") {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      forwardHeaders["content-type"] = forwardHeaders["content-type"] || "application/json";
    }
  }

  // ── Step 1: try unauthenticated
  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: "upstream_unreachable", error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  if (upstream.status !== 402) {
    const { text, truncated } = await readBoundedBody(upstream);
    return NextResponse.json({
      ok: upstream.ok,
      paid: false,
      upstream: {
        status: upstream.status,
        headers: Object.fromEntries(upstream.headers),
        body: text,
        truncated,
      },
    });
  }

  // ── Step 2: parse the 402 body
  const { text: q402Text } = await readBoundedBody(upstream);
  let q402: { accepts?: X402Accept[]; x402Version?: number } = {};
  try { q402 = JSON.parse(q402Text); } catch {
    return NextResponse.json({
      ok: false,
      reason: "upstream_402_unparseable",
      raw: q402Text.slice(0, 2000),
    }, { status: 502 });
  }
  const accepts = Array.isArray(q402.accepts) ? q402.accepts : [];
  if (accepts.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: "no_accepts",
      advice: "Resource returned 402 but did not advertise any x402 `accepts[]` quotes.",
      raw: q402,
    }, { status: 502 });
  }

  const maxPriceMinor = BigInt(Math.floor(max_price_usd * 10 ** USDC_DECIMALS));
  const picked = pickQuote(accepts, maxPriceMinor, network);
  if (!picked) {
    return NextResponse.json({
      ok: false,
      reason: "no_supported_quote",
      advice:
        "Dreyv currently settles x402 on Solana USDC only. The resource did not advertise a Solana USDC quote.",
      accepts,
    }, { status: 415 });
  }
  if ("over" in picked) {
    return NextResponse.json({
      ok: false,
      reason: "over_budget",
      max_price_usd,
      quote: { ...picked.quote, amount_usd: formatUsdc(picked.amountMinor) },
      advice: "Raise `max_price_usd` to authorise this payment, or pick a cheaper resource.",
    }, { status: 413 });
  }
  const { quote, amountMinor } = picked;
  if (!quote.payTo) {
    return NextResponse.json({ ok: false, reason: "quote_missing_payTo", quote }, { status: 502 });
  }

  // ── Step 3: settle on Solana from the agent's custodial wallet
  const wallet = await getOrCreateAgentWallet(key.userId, { withSecret: true });
  if (!wallet.secretBase58) {
    return NextResponse.json({ ok: false, reason: "agent_wallet_unavailable" }, { status: 500 });
  }
  const balances = await getWalletBalances({ publicKey: wallet.publicKey, mintAddress: SOLANA_USDC_MAINNET, decimals: USDC_DECIMALS });
  if (balances.solLamports < MIN_SOL_LAMPORTS_FOR_TX || balances.tokenMinor < amountMinor) {
    return NextResponse.json({
      ok: false,
      reason: "agent_wallet_underfunded",
      required: { usdc_minor: amountMinor.toString(), sol_lamports: MIN_SOL_LAMPORTS_FOR_TX.toString() },
      have: { usdc_minor: balances.tokenMinor.toString(), sol_lamports: balances.solLamports.toString() },
      wallet: wallet.publicKey,
      topup_url: "https://dreyv.com/api/agents/balance/topup",
      advice:
        "Top up the agent's prepaid balance (auto-funds the custodial wallet) or send USDC + a small SOL fee buffer directly.",
    }, { status: 402 });
  }

  const memo = `x402:${resourceHash(url)}`;
  let signature: string;
  try {
    const settled = await payInvoiceFromAgentWallet({
      agentSecretBase58: wallet.secretBase58,
      recipient: quote.payTo,
      mintAddress: SOLANA_USDC_MAINNET,
      amountMinor,
      decimals: USDC_DECIMALS,
      memo,
    });
    signature = settled.signature;
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: "settlement_failed",
      error: err instanceof Error ? err.message : String(err),
    }, { status: 502 });
  }

  // ── Step 4: build the X-PAYMENT payload and retry
  const xPaymentPayload = {
    x402Version: q402.x402Version ?? 1,
    scheme: quote.scheme ?? "exact",
    network: quote.network ?? "solana",
    payload: {
      signature,
      payer: wallet.publicKey,
      asset: SOLANA_USDC_MAINNET,
      amount: amountMinor.toString(),
      memo,
      resource: url,
    },
  };
  const xPaymentHeader = Buffer.from(JSON.stringify(xPaymentPayload), "utf8").toString("base64");

  let final: Response;
  try {
    final = await fetch(url, {
      ...init,
      headers: { ...forwardHeaders, "X-PAYMENT": xPaymentHeader },
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: "upstream_retry_failed",
      payment: { signature, amount_usdc: formatUsdc(amountMinor), payTo: quote.payTo, network: quote.network, memo },
      error: err instanceof Error ? err.message : String(err),
    }, { status: 502 });
  }

  const { text: finalText, truncated: finalTruncated } = await readBoundedBody(final);
  const status = final.status === 402 ? 502 : 200;
  return NextResponse.json({
    ok: final.ok,
    paid: true,
    payment: {
      signature,
      explorer: `https://solscan.io/tx/${signature}`,
      amount_usdc: formatUsdc(amountMinor),
      amount_minor: amountMinor.toString(),
      asset: "USDC",
      network: quote.network ?? "solana",
      payTo: quote.payTo,
      memo,
      from_wallet: wallet.publicKey,
    },
    upstream: {
      status: final.status,
      headers: Object.fromEntries(final.headers),
      body: finalText,
      truncated: finalTruncated,
      ...(final.status === 402 ? { warning: "Resource still returned 402 after settlement. The receipt above is valid; relay manually if needed." } : {}),
    },
  }, { status });
}
