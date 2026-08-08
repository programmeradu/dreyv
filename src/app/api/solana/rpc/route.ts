export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Lightweight per-IP burst guard for the RPC proxy.
// (User-tier quotas are NOT applied here — RPC reads are infrastructure,
// not a billable user action like Atlas tx lookups.)
const ipHits = new Map<string, { count: number; windowStart: number }>();
const IP_WINDOW_MS = 60_000; // 1 minute
const IP_MAX = 120;          // 120 RPC calls / IP / minute (2/s) — tightened after bot spike

function checkIpBurst(req: NextRequest): { allowed: boolean; retryAfterSec: number } {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > IP_WINDOW_MS) {
    ipHits.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > IP_MAX) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((IP_WINDOW_MS - (now - entry.windowStart)) / 1000),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

// In-memory cache for RPC responses (5 second TTL)
const rpcCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL_MS = 5000;

function getCacheKey(method: string, params: any): string {
  return `${method}:${JSON.stringify(params)}`;
}

function getCachedResult(key: string): { data: any; fromCache: boolean } | null {
  const cached = rpcCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    rpcCache.delete(key);
    return null;
  }
  return { data: cached.data, fromCache: true };
}

function setCachedResult(key: string, data: any): void {
  if (rpcCache.size > 1000) {
    const oldestKey = rpcCache.keys().next().value;
    if (oldestKey) rpcCache.delete(oldestKey);
  }
  rpcCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Minimal JSON-RPC proxy for Solana mainnet
// Auto-selects endpoint (public RPC by default; uses Helius when HELIUS_API_KEY is set). No env vars required.
export async function POST(req: NextRequest) {
  try {
    // IP burst guard only — no per-user quota on RPC reads.
    const burst = checkIpBurst(req);
    if (!burst.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          message: `RPC burst limit reached for this IP. Retry in ${burst.retryAfterSec}s.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(burst.retryAfterSec),
            "X-RateLimit-Limit": String(IP_MAX),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Scope": "ip-burst",
          },
        }
      );
    }

    const publicRpc = process.env.NEXT_PUBLIC_SOLANA_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    const heliusKey = process.env.HELIUS_API_KEY;
    const endpoint = publicRpc || (heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusKey)}` : "https://api.mainnet-beta.solana.com");
    const mockMode = process.env.NODE_ENV !== "production" && String(process.env.MOCK_MODE || "").toLowerCase() === "true";

    const raw = await req.text();

    // Parse request for caching
    let body: any = {};
    try { body = JSON.parse(raw || "{}"); } catch {}
    const method = body?.method;
    const params = body?.params || [];

    // Check cache first
    if (method && !mockMode) {
      const cacheKey = getCacheKey(method, params);
      const cached = getCachedResult(cacheKey);
      if (cached) {
        return NextResponse.json(cached.data, {
          status: 200,
          headers: { "X-Cache": "HIT" },
        });
      }
    }

    // Mock mode: synthesize responses for common methods used by Atlas
    if (mockMode) {
      const id = body?.id ?? 1;

      // Basic handlers
      if (method === "getInflationRate") {
        return NextResponse.json({ jsonrpc: "2.0", id, result: { epoch: 0, foundation: 0, total: 0.07, validator: 0.07 } });
      }
      if (method === "getBalance") {
        // 10 SOL default
        return NextResponse.json({ jsonrpc: "2.0", id, result: { context: { slot: 0 }, value: 10_000_000_000 } });
      }
      if (method === "getTokenAccountsByOwner") {
        // Return empty list by default
        return NextResponse.json({ jsonrpc: "2.0", id, result: { context: { slot: 0 }, value: [] } });
      }
      if (method === "getLatestBlockhash") {
        return NextResponse.json({ jsonrpc: "2.0", id, result: { context: { slot: 0 }, value: { blockhash: "MockBlockhash111", lastValidBlockHeight: 0 } } });
      }
      // Fallback generic ok
      return NextResponse.json({ jsonrpc: "2.0", id, result: null });
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: raw,
      // Avoid caching RPC
      next: { revalidate: 0 },
    });

    // Pipe through status + JSON
    const data = await res.json().catch(async () => {
      const text = await res.text();
      return { error: "Upstream non-JSON response", upstream: text };
    });

    // Cache successful responses
    if (method && res.ok) {
      const cacheKey = getCacheKey(method, params);
      setCachedResult(cacheKey, data);
    }

    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}