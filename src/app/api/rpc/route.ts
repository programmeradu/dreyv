import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSRF defense: strict allowlist of RPC host suffixes that callers may target
// via the `rpcUrl` body field. Anything outside this list is rejected.
const ALLOWED_HOST_SUFFIXES = [
  "nownodes.io",
  "llamarpc.com",
  "publicnode.com",
  "ankr.com",
  "infura.io",
  "alchemy.com",
  "blockpi.network",
  "1rpc.io",
  "arbitrum.io",
  "base.org",
  "polygon-rpc.com",
  "binance.org",
  "tenderly.co",
  "helius-rpc.com",
  "quiknode.pro",
];

// Block private/loopback/link-local/cloud-metadata destinations.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal") return true;

  // IPv4 literal check
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map((n) => parseInt(n, 10));
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // loopback
    if (a === 0) return true;                        // 0.0.0.0/8
    if (a === 169 && b === 254) return true;         // link-local / IMDS
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a >= 224) return true;                       // multicast / reserved
  }
  // IPv6 loopback / link-local / unique-local
  if (h === "::1" || h === "[::1]") return true;
  if (h.startsWith("fe80:") || h.startsWith("[fe80:")) return true;
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("[fc") || h.startsWith("[fd")) return true;

  return false;
}

function isAllowedRpcUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (isBlockedHost(host)) return false;
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

// Basic mapping for demo-default chains -> NowNodes RPC hostnames
const HOSTS: Record<string, string> = {
  ethereum: "https://eth.nownodes.io",
  arbitrum: "https://arbitrum.nownodes.io",
  base: "https://base.nownodes.io",
  polygon: "https://polygon.nownodes.io",
  matic: "https://matic.nownodes.io",
  bnb: "https://bsc.nownodes.io",
  bsc: "https://bsc.nownodes.io",
};

// Enhanced fallback mapping with more public/robust endpoints
const PUBLIC_HOSTS: Record<string, string> = {
  ethereum: "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161", // Public Infura (no key needed for basics)
  arbitrum: "https://arb1.arbitrum.io/rpc",
  base: "https://mainnet.base.org",
  polygon: "https://polygon-rpc.com",
  matic: "https://polygon-rpc.com",
  bnb: "https://bsc-dataseed.binance.org",
  bsc: "https://bsc-dataseed.binance.org",
};

// Expanded multi-provider fallbacks (prioritize reliable ones)
const EXTRA_FALLBACKS: Record<string, string[]> = {
  ethereum: [
    "https://ethereum.publicnode.com",
    "https://rpc.ankr.com/eth",
    "https://eth.llamarpc.com",
    "https://1rpc.io/eth",
  ],
  arbitrum: [
    "https://arbitrum.publicnode.com",
    "https://rpc.ankr.com/arbitrum",
    "https://arb1.llamarpc.com",
  ],
  base: [
    "https://base.gateway.tenderly.co",
    "https://base.publicnode.com",
    "https://base.llamarpc.com",
  ],
  polygon: [
    "https://polygon-bor.publicnode.com",
    "https://rpc.ankr.com/polygon",
    "https://polygon.llamarpc.com",
  ],
  bsc: [
    "https://bsc.publicnode.com",
    "https://rpc.ankr.com/bsc",
    "https://bsc.llamarpc.com",
  ],
};

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.NOWNODES_API_KEY;
    const body = await req.json();
    const rpcUrl: string | undefined = body.rpcUrl;
    const chainKey: string | undefined = body.chain;

    // Build candidates
    const candidates: string[] = [];
    if (rpcUrl) candidates.push(rpcUrl);

    if (chainKey) {
      const key = chainKey.toLowerCase();
      if (apiKey && HOSTS[key]) {
        candidates.push(`${HOSTS[key].replace(/\/$/, "")}/${apiKey}`);
      }
      if (PUBLIC_HOSTS[key]) candidates.push(PUBLIC_HOSTS[key]);
      if (Array.isArray(EXTRA_FALLBACKS[key])) candidates.push(...EXTRA_FALLBACKS[key]);
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueCandidates = candidates.filter((u) => {
      if (!u) return false;
      const k = u.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (uniqueCandidates.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing rpcUrl or unsupported chain", supported: Array.from(new Set([...Object.keys(HOSTS), ...Object.keys(PUBLIC_HOSTS)])) }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { jsonrpc, method, params, id } = body;
    if (!jsonrpc || !method || typeof id === "undefined") {
      return new Response(
        JSON.stringify({ error: "Invalid JSON-RPC body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Sequential fetch with longer timeout and per-endpoint error logging
    let lastText: string | null = null;
    let lastStatus = 502;
    for (let attempt = 0; attempt < uniqueCandidates.length; attempt++) {
      const targetBase = uniqueCandidates[attempt];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000); // Increased to 15s

      try {
        const upstream = await fetch(targetBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc, method, params: params ?? [], id }),
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const text = await upstream.text();
        if (upstream.ok) {
          const contentType = upstream.headers.get("content-type") || "application/json";
          return new Response(text, { status: upstream.status, headers: { "Content-Type": contentType } });
        } else {
          lastText = text;
          lastStatus = upstream.status;
          console.error(`RPC fallback ${attempt + 1} failed (${targetBase}): ${upstream.status} - ${text.slice(0, 200)}`);
        }
      } catch (e: any) {
        clearTimeout(timeout);
        console.error(`RPC fallback ${attempt + 1} network error (${targetBase}): ${e.message}`);
      }
    }

    // Log full debug info server-side only; never include endpoint URLs (which embed API keys) in the response.
    console.error("All RPC upstreams failed", { status: lastStatus, attempted: uniqueCandidates.length, lastBody: lastText?.slice(0, 500) });
    return new Response(
      JSON.stringify({ error: "All RPC upstreams failed after retries", status: lastStatus }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("RPC proxy error:", err);
    return new Response(
      JSON.stringify({ error: "RPC proxy error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}