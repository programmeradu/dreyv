"use client";

/**
 * LivePreview — Sandpack-based runtime for Dreyv mini-apps.
 *
 * Replaces the previous hand-rolled `srcDoc` iframe + Babel-standalone +
 * regex import rewriter + require shim. Sandpack runs a real esbuild-based
 * bundler inside its iframe, so multi-file projects, real npm packages,
 * TS/TSX, CSS and lucide-react / shadcn imports all "just work".
 *
 * The Dreyv bridge (BridgeController <-> postMessage) is preserved exactly:
 * we attach to Sandpack's iframe via `useSandpack().clients[id].iframe`
 * and keep all the existing `bridge.on(...)` handlers (proxy fetch, SDK
 * stubs, dreyv connector gateway, console capture).
 *
 * The SDK that user code imports (`@keystone-os/sdk` / `@dreyv/sdk`) is
 * shipped as virtual files inside `node_modules/@keystone-os/sdk/` so the
 * Sandpack bundler resolves them as a real dependency without us shipping
 * any code through the wire.
 */

import React, { useEffect, useRef, useMemo, useCallback } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import {
    SandpackProvider,
    SandpackPreview as SandpackIframe,
    useSandpack,
    type SandpackFiles,
} from "@codesandbox/sandpack-react";
import {
    BridgeController,
    BridgeMethods,
    IFRAME_BRIDGE_CLIENT,
} from "@/lib/studio/bridge-protocol";
import {
    stubLitEncrypt,
    stubLitDecrypt,
    stubACEReport,
    stubMCPCall,
    stubJupiterQuote,
    stubJupiterSwap,
    stubImpactReport,
    stubTaxForensics,
    stubYieldOptimize,
    stubGaslessSubmit,
    stubSIWSSign,
    stubBlinkExport,
} from "@/lib/studio/bridge-stubs";

// ─── Types ──────────────────────────────────────────────────────────

interface StudioFile {
    name: string;
    content: string;
    language: string;
}

interface LivePreviewProps {
    files: Record<string, StudioFile>;
    tab?: "preview" | "code";
    onLogsChange?: (logs: string[]) => void;
    walletAddress?: string | null;
    appId?: string;
}

// ─── Mint registry for live-price/holdings injection ───────────────

const MINTS: Record<string, string> = {
    SOL: "So11111111111111111111111111111111111111112",
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
};

// ─── SDK source (runs inside Sandpack iframe as a real ESM module) ──

/**
 * This string is written into Sandpack's virtual filesystem at
 * `/node_modules/@keystone-os/sdk/index.js`. It exports every hook and
 * primitive Dreyv mini-apps consume. The bridge instance it talks to
 * (`window.keystoneBridge`) is created by `_dreyv-bootstrap.js`, which
 * runs first because `index.tsx` imports it before anything else.
 *
 * Live data (prices, logos, real wallet holdings) is read from
 * `window.__dreyvInjected` which the bootstrap copies in from postMessage.
 */
const SDK_MODULE_SOURCE = `
import React from "react";

const bridge = () => window.keystoneBridge;
const injected = () => window.__dreyvInjected || {};

export function useVault() {
  const inj = injected();
  const prices = inj.prices || {};
  const logos = inj.logos || {};
  const live = inj.holdings;
  const walletConnected = !!inj.walletAddress;
  let tokens;
  if (walletConnected && Array.isArray(live) && live.length > 0) {
    tokens = live.map(h => ({
      symbol: h.symbol, name: h.name, balance: h.balance,
      price: prices[h.symbol] || 0, mint: h.mint, logoURI: logos[h.symbol] || "",
    }));
  } else {
    tokens = [
      { symbol: "SOL",  name: "Solana",   balance: 124.5,    price: prices.SOL  || 0,    mint: "So11111111111111111111111111111111111111112",  logoURI: logos.SOL  || "" },
      { symbol: "USDC", name: "USD Coin", balance: 5400.2,   price: prices.USDC || 1,    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", logoURI: logos.USDC || "" },
      { symbol: "BONK", name: "Bonk",     balance: 15000000, price: prices.BONK || 0,    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", logoURI: logos.BONK || "" },
      { symbol: "JUP",  name: "Jupiter",  balance: 850,      price: prices.JUP  || 0,    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",  logoURI: logos.JUP  || "" },
    ];
  }
  const balances = {};
  tokens.forEach(t => { balances[t.symbol] = t.balance; });
  return {
    activeVault: walletConnected ? "Connected Wallet" : "Demo Portfolio",
    balances, tokens,
  };
}

export function useTurnkey() {
  const reject = () => Promise.reject(new Error(
    "useTurnkey was removed. Build a transaction and return it for the host wallet to sign."
  ));
  return { getPublicKey: reject, signTransaction: reject };
}

export function useFetch(url, options = {}) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const fetchData = React.useCallback(() => {
    setLoading(true); setError(null);
    return bridge().call("proxy.fetch", {
      url, method: options.method || "GET",
      headers: options.headers || {}, body: options.body,
    }).then(setData).catch(err => {
      setError(err.message);
      console.error("[useFetch] " + url + ": " + err.message);
    }).finally(() => setLoading(false));
  }, [url, options.method, options.body]);
  React.useEffect(() => { fetchData(); }, [fetchData]);
  return { data, error, loading, refetch: fetchData };
}

export const AppEventBus = {
  emit(type, payload) {
    bridge().notify("event.emit", { type, payload });
    console.log("[EventBus]", type, payload);
  },
};

export function useEncryptedSecret() {
  return {
    encrypt: (plaintext, keyId) => bridge().call("lit.encryptSecret", { plaintext, keyId: keyId || "default" }),
    decrypt: (ciphertext, keyId) => bridge().call("lit.decryptSecret", { ciphertext, keyId: keyId || "default" }),
    loading: false, error: null,
  };
}

export function useACEReport(options = {}) {
  return {
    report: [], loading: false, error: null,
    refetch: () => bridge().call("ace.report", { since: options.since ? options.since.toISOString() : undefined }),
  };
}

export function useAgentHandoff(fromAgent) {
  return { handoffTo: (toAgent, context) => bridge().call("agent.handoff", { fromAgent, toAgent, context }) };
}

export function useMCPClient(serverUrl) {
  return {
    call: (tool, params) => bridge().call("mcp.call", { serverUrl, tool, params: params || {} }),
    loading: false, error: null,
  };
}

export function useMCPServer(tools, handlers) {
  return {
    registerTools: () => bridge().notify("mcp.serve", { tools }),
    handleCall: (tool, params) => handlers[tool]
      ? handlers[tool](params)
      : Promise.reject(new Error("Unknown tool")),
  };
}

export function useSIWS() {
  return {
    signIn: () => bridge().call("siws.sign", {}),
    verify: (message, signature) => bridge().call("siws.verify", { message, signature }),
    session: null,
  };
}

export function useJupiterSwap() {
  return {
    swap: (params) => bridge().call("jupiter.swap", params),
    getQuote: (params) => bridge().call("jupiter.quote", params),
    loading: false, error: null,
  };
}

export function useImpactReport() {
  return {
    simulate: (transaction) => bridge().call("simulation.impactReport", { transaction }),
    report: null, loading: false, error: null,
  };
}

export function useTaxForensics(options = {}) {
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const fetchResult = React.useCallback(() => {
    setLoading(true); setError(null);
    return bridge().call("tax.forensics", { since: options.since ? options.since.toISOString() : undefined })
      .then(setResult).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);
  React.useEffect(() => { fetchResult(); }, [fetchResult]);
  return { result, loading, error, refetch: fetchResult };
}

export function useYieldOptimizer(asset) {
  const [paths, setPaths] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const fetchPaths = React.useCallback(() => {
    setLoading(true); setError(null);
    return bridge().call("yield.optimize", { asset })
      .then(data => setPaths(data || []))
      .catch(err => { setError(err.message); setPaths([]); })
      .finally(() => setLoading(false));
  }, [asset]);
  React.useEffect(() => { fetchPaths(); }, [fetchPaths]);
  return { paths, loading, error, refetch: fetchPaths };
}

export function useGaslessTx() {
  return {
    submit: (transaction, description) => bridge().call("gasless.submit", { transaction, description }),
    loading: false, error: null,
  };
}

export function usePortfolio() {
  const vault = useVault();
  let totalValue = 0;
  const enriched = vault.tokens.map(t => {
    const usdValue = t.balance * (t.price || 0);
    totalValue += usdValue;
    return { symbol: t.symbol, name: t.name, balance: t.balance, price: t.price, usdValue, mint: t.mint, logoURI: t.logoURI, percentage: 0 };
  });
  enriched.forEach(t => { t.percentage = totalValue > 0 ? Math.round((t.usdValue / totalValue) * 10000) / 100 : 0; });
  return { tokens: enriched, totalValue, loading: false };
}

export function useTheme() {
  const [theme, setTheme] = React.useState("dark");
  return { theme, setTheme, isDark: theme === "dark" };
}

export function useTokenPrice(mint) {
  const [price, setPrice] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    if (!mint) return;
    setLoading(true);
    bridge().call("proxy.fetch", { url: "https://lite-api.jup.ag/price/v2?ids=" + mint, method: "GET", headers: {} })
      .then(data => {
        const p = data && data.data && data.data[mint];
        setPrice(p ? parseFloat(p.price) : null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [mint]);
  return { price, loading, error };
}

export function useNotification() {
  const [notifications, setNotifications] = React.useState([]);
  return {
    notifications,
    send: (message, type) => setNotifications(prev => prev.concat([{
      id: "n_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      message, type: type || "info", time: new Date(),
    }])),
    dismiss: (id) => setNotifications(prev => prev.filter(n => n.id !== id)),
    clearAll: () => setNotifications([]),
    unreadCount: notifications.length,
  };
}

export function useStorage(namespace) {
  const ns = namespace || "__ks_storage";
  const ref = React.useRef({});
  React.useEffect(() => {
    try { const saved = window.__ksStorageData && window.__ksStorageData[ns]; if (saved) ref.current = saved; } catch (e) {}
  }, []);
  const persist = () => { if (!window.__ksStorageData) window.__ksStorageData = {}; window.__ksStorageData[ns] = ref.current; };
  return {
    get: (key) => ref.current[key] !== undefined ? ref.current[key] : null,
    set: (key, value) => { ref.current[key] = value; persist(); },
    remove: (key) => { delete ref.current[key]; persist(); },
    keys: () => Object.keys(ref.current),
    clear: () => { ref.current = {}; persist(); },
  };
}
`;

/**
 * The bootstrap module runs as a side-effect import at the very top of
 * `index.tsx`. It installs `window.keystoneBridge` (via the existing
 * IFRAME_BRIDGE_CLIENT string), wires `console.*` forwarding, and listens
 * for a one-shot `__dreyv_inject__` postMessage from the host carrying live
 * prices / logos / wallet holdings.
 *
 * It also installs `window.dreyv` (Connector Gateway) and a basic shadcn-
 * style passthrough for `@/components/ui/*` for AI-generated apps that
 * import host UI primitives.
 */
const BOOTSTRAP_MODULE_SOURCE = `
${IFRAME_BRIDGE_CLIENT}
window.keystoneBridge = keystoneBridge;

// Console forwarding
(function () {
  const fwd = (level, args) => {
    try {
      keystoneBridge.notify("console." + level, {
        message: args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" "),
      });
    } catch (e) {}
  };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = function () { orig.log.apply(console, arguments); fwd("log", Array.from(arguments)); };
  console.warn = function () { orig.warn.apply(console, arguments); fwd("warn", Array.from(arguments)); };
  console.error = function () { orig.error.apply(console, arguments); fwd("error", Array.from(arguments)); };
  window.addEventListener("error", (e) => keystoneBridge.notify("runtime.error", {
    message: String(e.message), line: e.lineno, col: e.colno,
  }));
  window.addEventListener("unhandledrejection", (e) => keystoneBridge.notify("runtime.error", {
    message: "Unhandled Promise: " + String(e.reason && e.reason.message || e.reason),
  }));
})();

// Live data inbox
window.__dreyvInjected = window.__dreyvInjected || {};
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "__dreyv_inject__") return;
  Object.assign(window.__dreyvInjected, data.payload || {});
  window.dispatchEvent(new CustomEvent("dreyv:inject"));
});

// Dreyv Connector Gateway
const DREYV_PROVIDERS = ["helius","jupiter","birdeye","marinade","pyth","resend","telegram","slack"];
const dreyv = {
  invoke: (provider, operation, params) =>
    keystoneBridge.call("dreyv.invoke", { provider, operation, params: params || {} }),
  listConnections: () => keystoneBridge.call("dreyv.listConnections", {}),
};
DREYV_PROVIDERS.forEach((p) => {
  dreyv[p] = new Proxy({}, {
    get: (_t, op) => (params) => dreyv.invoke(p, String(op), params || {}),
  });
});
window.dreyv = dreyv;

// Signal ready to host
keystoneBridge.notify("runtime.ready", {});
`;

/**
 * Wrapper /index.tsx — boots bridge, then mounts user's App.
 * User's App is always at /App.tsx by Studio convention.
 */
const INDEX_TSX_SOURCE = `
import "./_dreyv-bootstrap.js";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    try {
      window.keystoneBridge.notify("runtime.error", {
        message: error && error.message ? error.message : String(error),
        componentStack: info && info.componentStack ? info.componentStack.slice(0, 500) : undefined,
      });
    } catch (e) {}
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: "#ef4444", padding: 20, fontFamily: "monospace", fontSize: 13, lineHeight: 1.6 }}>
          <strong style={{ color: "#f87171" }}>Component Error</strong>
          <br />
          <span style={{ color: "#fca5a5" }}>{this.state.error.message || String(this.state.error)}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById("root"));
root.render(<ErrorBoundary><App /></ErrorBoundary>);
`;

const INDEX_HTML_SOURCE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <style>
    body { margin: 0; background: #ffffff; color: #0f172a; font-family: 'Manrope', system-ui, -apple-system, sans-serif; min-height: 100vh; }
    #root { min-height: 100vh; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #ffffff; }
    ::-webkit-scrollbar-thumb { background: #ddd6fe; border-radius: 3px; }
  </style>
</head>
<body><div id="root"></div></body>
</html>`;

/**
 * Minimal shadcn-style passthrough for `@/components/ui/*` imports —
 * AI-generated mini-apps frequently use them but the host's real shadcn
 * lives outside the iframe.
 */
const UI_SHIM_SOURCE = `
import React from "react";

const mk = (Tag, base) => React.forwardRef(function Shim(props, ref) {
  const { className = "", ...rest } = props;
  return React.createElement(Tag, { ref, ...rest, className: (base + " " + className).trim() });
});

export const Card           = mk("div", "rounded-3xl border border-violet-100 bg-white p-4");
export const CardHeader     = mk("div", "mb-3 flex flex-col gap-1");
export const CardTitle      = mk("h3", "text-base font-semibold text-slate-900");
export const CardDescription= mk("p", "text-sm text-slate-500");
export const CardContent    = mk("div", "");
export const CardFooter     = mk("div", "mt-3 flex items-center gap-2");
export const Button         = mk("button", "inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700");
export const Input          = mk("input", "w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm");
export const Label          = mk("label", "text-sm font-medium text-slate-700");
export const Badge          = mk("span", "inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs text-violet-700");
export const Separator      = mk("div", "h-px w-full bg-violet-100");
export const Skeleton       = mk("div", "animate-pulse rounded-xl bg-violet-100/60");
`;

// ─── BridgeBinder — wires the host BridgeController to Sandpack iframe ──

interface BridgeBinderProps {
    walletAddress: string | null;
    appId?: string;
    livePrices: Record<string, number>;
    tokenLogos: Record<string, string>;
    liveHoldings: unknown;
    onLogsChange?: (logs: string[]) => void;
    onError: (msg: string | null) => void;
    onReady: () => void;
}

function BridgeBinder({
    walletAddress,
    appId,
    livePrices,
    tokenLogos,
    liveHoldings,
    onLogsChange,
    onError,
    onReady,
}: BridgeBinderProps) {
    const { sandpack } = useSandpack();
    const bridgeRef = useRef<BridgeController | null>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const logsRef = useRef<string[]>([]);

    const pushLog = useCallback((line: string) => {
        logsRef.current = [...logsRef.current.slice(-500), line];
        onLogsChange?.(logsRef.current);
    }, [onLogsChange]);

    // Pick up Sandpack's iframe whenever a new client registers.
    useEffect(() => {
        const ids = Object.keys(sandpack.clients);
        if (ids.length === 0) return;
        const client = sandpack.clients[ids[0]];
        const iframe = client?.iframe ?? null;
        if (!iframe || iframe === iframeRef.current) return;
        iframeRef.current = iframe;

        // Inject live prices/holdings into the iframe via postMessage. The
        // bootstrap module listens for `__dreyv_inject__` and copies the
        // payload to `window.__dreyvInjected`.
        const sendInjection = () => {
            try {
                iframe.contentWindow?.postMessage({
                    type: "__dreyv_inject__",
                    payload: {
                        prices: livePrices,
                        logos: tokenLogos,
                        holdings: liveHoldings,
                        walletAddress,
                    },
                }, "*");
            } catch {}
        };
        // Send shortly after mount so bootstrap has installed its listener.
        const t = setTimeout(sendInjection, 200);
        const t2 = setTimeout(sendInjection, 800); // belt-and-braces
        return () => { clearTimeout(t); clearTimeout(t2); };
    }, [sandpack.clients, livePrices, tokenLogos, liveHoldings, walletAddress]);

    // Mount BridgeController against the iframe ref.
    useEffect(() => {
        if (!iframeRef.current) return;
        const fakeRef = { current: iframeRef.current } as React.RefObject<HTMLIFrameElement | null>;
        const bridge = new BridgeController(fakeRef);
        bridgeRef.current = bridge;

        // ─── Console + lifecycle ───
        bridge.on(BridgeMethods.CONSOLE_LOG,   async (p) => { pushLog(`[info] ${p.message}`); return null; });
        bridge.on(BridgeMethods.CONSOLE_WARN,  async (p) => { pushLog(`[warn] ${p.message}`); return null; });
        bridge.on(BridgeMethods.CONSOLE_ERROR, async (p) => { pushLog(`[error] ${p.message}`); return null; });
        bridge.on(BridgeMethods.RUNTIME_READY, async () => { onError(null); onReady(); return { status: "ok" }; });
        bridge.on(BridgeMethods.RUNTIME_ERROR, async (p) => {
            const msg = String(p.message || "Unknown runtime error");
            onError(msg);
            pushLog(`[error] ${msg}`);
            return null;
        });

        // ─── Proxy fetch ───
        bridge.on(BridgeMethods.PROXY_REQUEST, async (params) => {
            const { observability, ...rest } = params as Record<string, unknown>;
            if (observability) pushLog(`[info] [Observability] ${JSON.stringify(observability)}`);
            const { url, method, headers, body } = rest as {
                url: string; method?: string; headers?: Record<string, string>; body?: unknown;
            };
            const proxyRes = await fetch("/api/proxy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, method: method || "GET", headers: headers || {}, body, appId }),
            });
            const result = await proxyRes.json();
            pushLog(`[info] [Proxy] ${method || "GET"} ${url} → ${proxyRes.status}`);
            if (!proxyRes.ok) throw new Error(result.error || `Proxy returned ${proxyRes.status}`);
            return result.data;
        });

        // ─── Event bus ───
        bridge.on(BridgeMethods.EVENT_EMIT, async (params) => {
            pushLog(`[event] ${params.type}: ${JSON.stringify(params.payload)}`);
            return null;
        });

        // ─── Sovereign OS 2026 mock handlers ───
        bridge.on(BridgeMethods.LIT_ENCRYPT, async (p) => {
            const params = p as { plaintext: string; keyId?: string };
            pushLog(`[lit] encrypt (keyId: ${params.keyId || "default"})`);
            return stubLitEncrypt(params);
        });
        bridge.on(BridgeMethods.LIT_DECRYPT, async (p) => {
            const params = p as { ciphertext: string; keyId?: string };
            pushLog(`[lit] decrypt (keyId: ${params.keyId || "default"})`);
            return stubLitDecrypt(params);
        });
        bridge.on(BridgeMethods.ACE_REPORT, async (p) => {
            pushLog(`[ace] report requested`);
            return stubACEReport(p as { since?: string });
        });
        bridge.on(BridgeMethods.ZKSP_VERIFY, async () => ({ verified: false }));
        bridge.on(BridgeMethods.AGENT_HANDOFF, async (p) => {
            const params = p as { fromAgent?: string; toAgent?: string };
            pushLog(`[agent] handoff ${params.fromAgent} → ${params.toAgent}`);
            return { status: "handoff_received" };
        });
        bridge.on(BridgeMethods.MCP_CALL, async (p) => {
            const params = p as { serverUrl: string; tool: string; params?: Record<string, unknown> };
            pushLog(`[mcp] call ${params.tool} via ${params.serverUrl}`);
            return stubMCPCall(params);
        });
        bridge.on(BridgeMethods.MCP_SERVE, async (p) => {
            pushLog(`[mcp] serve tools: ${((p as { tools?: unknown[] }).tools ?? []).length}`);
            return null;
        });
        bridge.on(BridgeMethods.IMPACT_REPORT, async (p) => {
            pushLog(`[simulation] impact report for tx`);
            return stubImpactReport(p as { transaction?: unknown });
        });
        bridge.on(BridgeMethods.SIWS_SIGN, async () => {
            pushLog(`[siws] sign-in requested`);
            return stubSIWSSign(walletAddress ?? null);
        });
        bridge.on(BridgeMethods.SIWS_VERIFY, async () => true);
        bridge.on(BridgeMethods.JUPITER_SWAP, async (p) => {
            const params = p as { inputMint: string; outputMint: string; amount: string; slippageBps?: number };
            pushLog(`[jupiter] swap ${params.amount} ${params.inputMint} → ${params.outputMint}`);
            return stubJupiterSwap(params);
        });
        bridge.on(BridgeMethods.JUPITER_QUOTE, async (p) => {
            const params = p as { inputMint: string; outputMint: string; amount: string; slippageBps?: number };
            const isLive = !!walletAddress;
            pushLog(`[jupiter] quote ${params.amount} ${params.inputMint} → ${params.outputMint}${isLive ? " (LIVE)" : " (mock)"}`);
            return stubJupiterQuote(params, isLive);
        });
        bridge.on(BridgeMethods.YIELD_OPTIMIZE, async (p) => {
            const params = p as { asset: string };
            const isLive = !!walletAddress;
            pushLog(`[yield] optimize for ${params.asset}${isLive ? " (LIVE)" : " (mock)"}`);
            return stubYieldOptimize(params, isLive);
        });
        bridge.on(BridgeMethods.GASLESS_SUBMIT, async (p) => {
            const params = p as { transaction: unknown; description?: string };
            pushLog(`[gasless] submit: ${params.description || "gasless tx"}`);
            return stubGaslessSubmit(params);
        });
        bridge.on(BridgeMethods.BLINK_EXPORT, async (p) => {
            const params = p as { label?: string };
            pushLog(`[blink] export action: ${params.label}`);
            return stubBlinkExport(params);
        });
        bridge.on(BridgeMethods.TAX_FORENSICS, async (p) => {
            pushLog(`[tax] forensics requested`);
            return stubTaxForensics(p as { since?: string });
        });

        // ─── Dreyv Connector Gateway ───
        bridge.on("dreyv.invoke", async (p) => {
            const { provider, operation, params } = p as {
                provider: string; operation: string; params?: Record<string, unknown>;
            };
            pushLog(`[dreyv] ${provider}.${operation}`);
            const res = await fetch(`/api/dreyv-gateway/${encodeURIComponent(provider)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ operation, params }),
            });
            const json = await res.json();
            if (!res.ok) {
                pushLog(`[dreyv] error ${res.status}: ${json?.error || "unknown"}`);
                if (res.status === 412 && typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("dreyv:connection_required", {
                        detail: { provider: json?.provider || provider, operation },
                    }));
                }
                throw new Error(json?.message || json?.error || `Gateway ${res.status}`);
            }
            return json.data;
        });
        bridge.on("dreyv.listConnections", async () => {
            const res = await fetch("/api/dreyv-gateway/connections");
            const json = await res.json();
            return json.connections || [];
        });

        bridge.start();
        return () => { bridge.stop(); bridgeRef.current = null; };
    }, [walletAddress, appId, pushLog, onError, onReady]);

    return null;
}

// ─── Main component ─────────────────────────────────────────────────

export function LivePreview({
    files,
    tab = "preview",
    onLogsChange,
    walletAddress = null,
    appId,
}: LivePreviewProps) {
    const [error, setError] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [logs, setLogs] = React.useState<string[]>([]);
    const [retryKey, setRetryKey] = React.useState(0);

    // ─── Fetch live prices/logos/holdings (proxied from parent) ──
    const [livePrices, setLivePrices] = React.useState<Record<string, number>>({});
    const [tokenLogos, setTokenLogos] = React.useState<Record<string, string>>({});
    const [liveHoldings, setLiveHoldings] = React.useState<unknown>(null);

    useEffect(() => {
        if (!walletAddress) { setLiveHoldings(null); return; }
        let cancelled = false;
        fetch(`/api/helius/das/wallet-holdings?address=${walletAddress}`, { signal: AbortSignal.timeout(10000) })
            .then(r => r.json())
            .then(json => {
                if (cancelled) return;
                const holdings = json?.holdings || [];
                const mintToSym: Record<string, string> = {};
                for (const [sym, mint] of Object.entries(MINTS)) mintToSym[mint] = sym;
                setLiveHoldings(holdings.map((h: { mint: string; symbol?: string; name?: string; balance: number; decimals?: number }) => ({
                    symbol: mintToSym[h.mint] || h.symbol || "UNKNOWN",
                    name: h.name || h.symbol || "Unknown",
                    balance: Number(h.balance) / Math.pow(10, h.decimals || 0),
                    mint: h.mint,
                    decimals: h.decimals || 0,
                })));
            })
            .catch(() => { if (!cancelled) setLiveHoldings(null); });
        return () => { cancelled = true; };
    }, [walletAddress]);

    useEffect(() => {
        const ids = Object.values(MINTS).join(",");
        fetch(`https://lite-api.jup.ag/price/v2?ids=${ids}`, { signal: AbortSignal.timeout(6000) })
            .then(r => r.json())
            .then(json => {
                const data = json?.data || {};
                const prices: Record<string, number> = {};
                for (const [sym, mint] of Object.entries(MINTS)) prices[sym] = parseFloat(data[mint]?.price) || 0;
                setLivePrices(prices);
            })
            .catch(() => setLivePrices({ SOL: 23.4, USDC: 1.0, BONK: 0.000024, JUP: 1.12 }));

        fetch("https://token.jup.ag/strict", { signal: AbortSignal.timeout(8000) })
            .then(r => r.json())
            .then(async (list: { address: string; logoURI?: string }[]) => {
                const mintToSym: Record<string, string> = {};
                for (const [sym, mint] of Object.entries(MINTS)) mintToSym[mint] = sym;
                const relevant = list.filter((t) => mintToSym[t.address] && t.logoURI);
                const logos: Record<string, string> = {};
                await Promise.allSettled(relevant.map(async (t) => {
                    try {
                        const res = await fetch(t.logoURI as string, { signal: AbortSignal.timeout(5000) });
                        if (!res.ok) return;
                        const blob = await res.blob();
                        const dataUri: string = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.readAsDataURL(blob);
                        });
                        logos[mintToSym[t.address]] = dataUri;
                    } catch {}
                }));
                setTokenLogos(logos);
            })
            .catch(() => {});
    }, []);

    // ─── Build Sandpack file map ─────────────────────────────────────
    // Convention: user code lives at /App.tsx (and any other paths it uses).
    // We add /index.html, /index.tsx, /_dreyv-bootstrap.js, /_dreyv-ui.js
    // and /node_modules/@keystone-os/sdk/{index.js,package.json}.
    const sandpackFiles: SandpackFiles = useMemo(() => {
        const map: SandpackFiles = {
            "/index.html":            { code: INDEX_HTML_SOURCE, hidden: true },
            "/index.tsx":             { code: INDEX_TSX_SOURCE, hidden: true },
            "/_dreyv-bootstrap.js":   { code: BOOTSTRAP_MODULE_SOURCE, hidden: true },
            "/components/ui/index.js":{ code: UI_SHIM_SOURCE, hidden: true },
            "/node_modules/@keystone-os/sdk/package.json": {
                code: JSON.stringify({ name: "@keystone-os/sdk", version: "1.0.0", main: "index.js" }),
                hidden: true,
            },
            "/node_modules/@keystone-os/sdk/index.js": { code: SDK_MODULE_SOURCE, hidden: true },
            // Alias @dreyv/sdk → @keystone-os/sdk
            "/node_modules/@dreyv/sdk/package.json": {
                code: JSON.stringify({ name: "@dreyv/sdk", version: "1.0.0", main: "index.js" }),
                hidden: true,
            },
            "/node_modules/@dreyv/sdk/index.js": {
                code: `module.exports = require("@keystone-os/sdk");`,
                hidden: true,
            },
        };
        // User files
        for (const file of Object.values(files)) {
            const path = file.name.startsWith("/") ? file.name : `/${file.name}`;
            map[path] = { code: file.content };
        }
        // Ensure App.tsx exists so /index.tsx import doesn't fail
        if (!map["/App.tsx"] && !map["/App.jsx"] && !map["/App.js"]) {
            map["/App.tsx"] = {
                code: `export default function App() {
  return <div className="p-8 text-zinc-500 font-mono text-xs">No App.tsx provided.</div>;
}`,
            };
        }
        return map;
    }, [files]);

    // Sync logs callback up
    useEffect(() => { onLogsChange?.(logs); }, [logs, onLogsChange]);
    const handleLogsChange = useCallback((next: string[]) => setLogs(next), []);

    // ─── Console tab (unchanged UI) ─────────────────────────────────
    const [consoleFilter, setConsoleFilter] = React.useState<"all" | "info" | "warn" | "error" | "event">("all");
    if (tab === "code") {
        const filteredLogs = consoleFilter === "all"
            ? logs
            : logs.filter((log) => {
                if (consoleFilter === "info") return log.startsWith("[info]");
                if (consoleFilter === "warn") return log.startsWith("[warn]");
                if (consoleFilter === "error") return log.startsWith("[error]");
                if (consoleFilter === "event") return log.startsWith("[event]") || log.startsWith("[lit]") || log.startsWith("[mcp]") || log.startsWith("[jupiter]") || log.startsWith("[siws]");
                return true;
            });
        const errorCount = logs.filter((l) => l.startsWith("[error]")).length;
        const warnCount = logs.filter((l) => l.startsWith("[warn]")).length;
        return (
            <div className="h-full w-full bg-[#011627] flex flex-col font-mono text-xs">
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
                    <div className="flex items-center gap-1">
                        {(["all", "info", "warn", "error", "event"] as const).map((f) => (
                            <button
                                key={f}
                                onClick={() => setConsoleFilter(f)}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${
                                    consoleFilter === f
                                        ? f === "error" ? "bg-red-500/20 text-red-400"
                                        : f === "warn" ? "bg-yellow-500/20 text-yellow-400"
                                        : f === "event" ? "bg-cyan-500/20 text-cyan-400"
                                        : "bg-emerald-500/20 text-emerald-400"
                                        : "text-zinc-600 hover:text-zinc-400"
                                }`}
                            >
                                {f}
                                {f === "error" && errorCount > 0 && <span className="ml-1 text-[9px]">({errorCount})</span>}
                                {f === "warn" && warnCount > 0 && <span className="ml-1 text-[9px]">({warnCount})</span>}
                            </button>
                        ))}
                    </div>
                    <button onClick={() => setLogs([])} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors uppercase tracking-wider">
                        Clear
                    </button>
                </div>
                <div className="flex-1 overflow-auto p-3">
                    {filteredLogs.length === 0 ? (
                        <div className="text-zinc-600 italic pt-4 text-center">
                            {logs.length === 0 ? "No logs yet — interact with your Mini-App" : `No ${consoleFilter} logs`}
                        </div>
                    ) : (
                        filteredLogs.map((log, i) => {
                            const isError = log.startsWith("[error]");
                            const isWarn = log.startsWith("[warn]");
                            const isEvent = log.startsWith("[event]") || log.startsWith("[lit]") || log.startsWith("[mcp]") || log.startsWith("[jupiter]");
                            return (
                                <div key={i} className={`py-1 border-b border-zinc-900/30 flex items-start gap-2 ${
                                    isError ? "text-red-400 bg-red-500/5"
                                    : isWarn ? "text-yellow-400"
                                    : isEvent ? "text-cyan-400"
                                    : "text-zinc-300"
                                }`}>
                                    <span className="text-zinc-700 shrink-0 select-none w-6 text-right">{i + 1}</span>
                                    <span className="break-all">{log}</span>
                                </div>
                            );
                        })
                    )}
                </div>
                <div className="px-3 py-1 border-t border-zinc-800 text-[10px] text-zinc-600 flex items-center justify-between shrink-0">
                    <span>{logs.length} log entries</span>
                    <span>{errorCount > 0 ? `${errorCount} errors` : "No errors"}</span>
                </div>
            </div>
        );
    }

    // ─── Preview tab ─────────────────────────────────────────────────
    return (
        <div className="h-full w-full relative bg-[#09090b]">
            {isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b] z-10 transition-opacity duration-300 pointer-events-none">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-4" />
                    <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Booting Kernel...</p>
                </div>
            )}
            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]/95 z-20 p-8 backdrop-blur-sm">
                    <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-xl max-w-md w-full">
                        <div className="flex items-center gap-3 mb-3 text-red-500">
                            <AlertTriangle className="w-5 h-5" />
                            <span className="font-bold uppercase tracking-wider text-xs">Runtime Error</span>
                        </div>
                        <p className="text-sm text-zinc-300 font-mono break-words leading-relaxed">{error}</p>
                    </div>
                    <button
                        onClick={() => { setError(null); setIsLoading(true); setRetryKey(k => k + 1); }}
                        className="mt-6 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-bold rounded uppercase tracking-wider transition-colors"
                    >
                        Retry Render
                    </button>
                </div>
            )}
            <SandpackProvider
                key={retryKey}
                template="react-ts"
                files={sandpackFiles}
                customSetup={{
                    entry: "/index.tsx",
                    dependencies: {
                        "react": "^18.2.0",
                        "react-dom": "^18.2.0",
                        "lucide-react": "^0.400.0",
                        "framer-motion": "^11.5.4",
                        "recharts": "^2.12.7",
                        "date-fns": "^3.6.0",
                    },
                }}
                options={{ recompileMode: "delayed", recompileDelay: 300 }}
            >
                <BridgeBinder
                    walletAddress={walletAddress}
                    appId={appId}
                    livePrices={livePrices}
                    tokenLogos={tokenLogos}
                    liveHoldings={liveHoldings}
                    onLogsChange={handleLogsChange}
                    onError={setError}
                    onReady={() => setIsLoading(false)}
                />
                <SandpackIframe
                    showOpenInCodeSandbox={false}
                    showRefreshButton={false}
                    showRestartButton={false}
                    style={{ height: "100%", width: "100%", border: "none", background: "#09090b" }}
                />
            </SandpackProvider>
        </div>
    );
}
