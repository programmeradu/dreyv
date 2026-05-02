"use client";

/**
 * LivePreview — instant in-browser runtime for Dreyv mini-apps.
 *
 * The preview compiles TSX with Babel in the host page, then executes it
 * inside a same-origin sandboxed iframe with a small CommonJS module loader.
 * This avoids Sandpack remote bundler timeouts and avoids WebContainer's slow
 * first-run npm install path.
 *
 * The Dreyv bridge (BridgeController <-> postMessage) is preserved: we attach
 * to the preview iframe via its ref and keep all existing bridge handlers.
 */

import React, { useEffect, useRef, useMemo, useCallback, useState } from "react";
import * as Babel from "@babel/standalone";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as ReactJSXRuntime from "react/jsx-runtime";
import * as ReactJSXDevRuntime from "react/jsx-dev-runtime";
import * as LucideReact from "lucide-react";
import * as Recharts from "recharts";
import * as FramerMotion from "framer-motion";
import * as DateFns from "date-fns";
import { Loader2, AlertTriangle } from "lucide-react";
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

// ─── SDK source (runs inside WebContainer Vite project as a local pkg) ──
// Same surface as before: every Dreyv hook talks to window.keystoneBridge,
// which the bootstrap module installs.
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

// Bootstrap module — runs in iframe before user App renders.
const BOOTSTRAP_MODULE_SOURCE = `
${IFRAME_BRIDGE_CLIENT}
window.keystoneBridge = keystoneBridge;

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

window.__dreyvInjected = window.__dreyvInjected || {};
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "__dreyv_inject__") return;
  Object.assign(window.__dreyvInjected, data.payload || {});
  window.dispatchEvent(new CustomEvent("dreyv:inject"));
});

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

keystoneBridge.notify("runtime.ready", {});

export {};
`;

const MAIN_TSX_SOURCE = `
import "./_dreyv-bootstrap";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

class ErrorBoundary extends React.Component {
  state: { error: any } = { error: null };
  static getDerivedStateFromError(error: any) { return { error }; }
  componentDidCatch(error: any, info: any) {
    try {
      (window as any).keystoneBridge.notify("runtime.error", {
        message: error && error.message ? error.message : String(error),
        componentStack: info && info.componentStack ? info.componentStack.slice(0, 500) : undefined,
      });
    } catch (e) {}
  }
  render() {
    if ((this.state as any).error) {
      const e = (this.state as any).error;
      return (
        <div style={{ color: "#ef4444", padding: 20, fontFamily: "monospace", fontSize: 13, lineHeight: 1.6 }}>
          <strong style={{ color: "#f87171" }}>Component Error</strong>
          <br />
          <span style={{ color: "#fca5a5" }}>{e.message || String(e)}</span>
        </div>
      );
    }
    return (this.props as any).children;
  }
}

const root = createRoot(document.getElementById("root")!);
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
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>`;

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

const VITE_CONFIG_SOURCE = `
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
  resolve: {
    alias: {
      "@/components/ui": "/src/components/ui",
    },
  },
});
`;

const TSCONFIG_SOURCE = JSON.stringify({
    compilerOptions: {
        target: "ES2020",
        useDefineForClassFields: true,
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        module: "ESNext",
        skipLibCheck: true,
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
        strict: false,
        allowJs: true,
        esModuleInterop: true,
    },
    include: ["src"],
}, null, 2);

type CompiledRuntime = {
    entry: string;
    modules: Record<string, string>;
};

const SHADCN_UI_ALIASES = [
    "@/components/ui",
    "@/components/ui/card",
    "@/components/ui/button",
    "@/components/ui/input",
    "@/components/ui/label",
    "@/components/ui/badge",
    "@/components/ui/separator",
    "@/components/ui/skeleton",
];

const LOCAL_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

const DREYV_SDK_ALIAS_INDEX = `export * from "@keystone-os/sdk";\n`;

declare global {
    interface Window {
        __dreyvPreviewRuntime?: {
            React: typeof React;
            createRoot: typeof ReactDOMClient.createRoot;
            externals: Record<string, unknown>;
        };
    }
}

function normalisePreviewPath(path: string): string {
    const cleaned = path.replace(/^\/+/, "").replace(/\\/g, "/");
    return cleaned.startsWith("src/") ? `/${cleaned}` : `/src/${cleaned}`;
}

function compileModule(source: string, filename: string): string {
    const result = Babel.transform(source, {
        filename,
        presets: [
            ["react", { runtime: "automatic", importSource: "react" }],
            ["typescript", { isTSX: /\.[tj]sx$/.test(filename), allExtensions: true, allowDeclareFields: true }],
        ],
        plugins: ["transform-modules-commonjs"],
        retainLines: true,
        sourceMaps: "inline",
    });
    return result.code || "";
}

function buildCompiledRuntime(files: Record<string, StudioFile>): CompiledRuntime {
    const modules: Record<string, string> = {};
    let entry = "/src/App.tsx";

    for (const f of Object.values(files)) {
        const id = normalisePreviewPath(f.name);
        modules[id] = compileModule(f.content, id);
        if (/\/App\.(tsx|jsx|ts|js)$/.test(id)) entry = id;
    }

    if (!Object.keys(modules).some((id) => /\/App\.(tsx|jsx|ts|js)$/.test(id))) {
        modules[entry] = compileModule(
            `export default function App() {\n  return <div className="p-8 text-slate-500 font-mono text-xs">No App.tsx provided.</div>;\n}\n`,
            entry,
        );
    }

    modules["@keystone-os/sdk"] = compileModule(SDK_MODULE_SOURCE, "@keystone-os/sdk/index.js");
    modules["@dreyv/sdk"] = compileModule(DREYV_SDK_ALIAS_INDEX, "@dreyv/sdk/index.js");
    const uiShim = compileModule(UI_SHIM_SOURCE, "@/components/ui/index.js");
    for (const alias of SHADCN_UI_ALIASES) modules[alias] = uiShim;

    return { entry, modules };
}

function scriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/<\//g, "<\\/");
}

function buildRuntimeHtml(runtime: CompiledRuntime): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com" crossorigin="anonymous"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    body { margin: 0; background: #ffffff; color: #0f172a; font-family: 'Manrope', system-ui, -apple-system, sans-serif; min-height: 100vh; }
    #root { min-height: 100vh; }
    .runtime-error { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; margin: 24px; padding: 18px; border-radius: 18px; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #ffffff; }
    ::-webkit-scrollbar-thumb { background: #ddd6fe; border-radius: 3px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
${IFRAME_BRIDGE_CLIENT}
window.keystoneBridge = keystoneBridge;

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

window.__dreyvInjected = window.__dreyvInjected || {};
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "__dreyv_inject__") return;
  Object.assign(window.__dreyvInjected, data.payload || {});
  window.dispatchEvent(new CustomEvent("dreyv:inject"));
});

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
  </script>
  <script>
(function () {
  const host = window.parent.__dreyvPreviewRuntime;
  const modules = ${scriptJson(runtime.modules)};
  const entry = ${scriptJson(runtime.entry)};
  const cache = {};
  const extensions = ${scriptJson(LOCAL_EXTENSIONS)};

  function showError(error) {
    const message = error && error.stack ? error.stack : (error && error.message ? error.message : String(error));
    document.getElementById("root").innerHTML = '<div class="runtime-error"><strong>Runtime Error</strong>\n' + message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</div>';
    try { keystoneBridge.notify("runtime.error", { message }); } catch (e) {}
  }

  if (!host || !host.React || !host.createRoot) {
    showError(new Error("Preview runtime was not initialized by the host."));
    return;
  }

  function clean(path) {
    const parts = [];
    path.replace(/\\/g, "/").split("/").forEach((part) => {
      if (!part || part === ".") return;
      if (part === "..") parts.pop();
      else parts.push(part);
    });
    return "/" + parts.join("/");
  }

  function pick(candidate) {
    if (modules[candidate]) return candidate;
    for (const ext of extensions) if (modules[candidate + ext]) return candidate + ext;
    for (const ext of extensions) if (modules[candidate + "/index" + ext]) return candidate + "/index" + ext;
    return candidate;
  }

  function resolve(parentId, request) {
    if (!request) return request;
    if (request.endsWith(".css")) return request;
    if (host.externals && host.externals[request]) return request;
    if (modules[request]) return request;
    if (request.startsWith("@/")) return pick("/src/" + request.slice(2));
    if (!request.startsWith(".") && !request.startsWith("/")) return request;
    const base = parentId.startsWith("/") ? parentId.slice(0, parentId.lastIndexOf("/")) : "";
    return pick(clean(request.startsWith("/") ? request : base + "/" + request));
  }

  function execute(id) {
    if (id.endsWith(".css")) return {};
    if (host.externals && host.externals[id]) return host.externals[id];
    if (!modules[id]) throw new Error("Module not found: " + id);
    if (cache[id]) return cache[id].exports;
    const module = { exports: {} };
    cache[id] = module;
    const require = (request) => execute(resolve(id, request));
    new Function("require", "module", "exports", modules[id] + "\n//# sourceURL=dreyv-preview:" + id)(require, module, module.exports);
    return module.exports;
  }

  class ErrorBoundary extends host.React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error, info) {
      try { keystoneBridge.notify("runtime.error", { message: error && error.message ? error.message : String(error), componentStack: info && info.componentStack }); } catch (e) {}
    }
    render() {
      if (this.state.error) {
        return host.React.createElement("div", { className: "runtime-error" }, "Component Error\n" + (this.state.error.message || String(this.state.error)));
      }
      return this.props.children;
    }
  }

  setTimeout(() => {
    try {
      const appModule = execute(entry);
      const App = appModule.default || appModule.App || appModule;
      host.createRoot(document.getElementById("root")).render(
        host.React.createElement(ErrorBoundary, null, host.React.createElement(App))
      );
      keystoneBridge.notify("runtime.ready", {});
    } catch (error) {
      showError(error);
    }
  }, 50);
})();
  </script>
</body>
</html>`;
}

// ─── Main component ──────────────────────────────────────────────────

export function LivePreview({
    files,
    tab = "preview",
    onLogsChange,
    walletAddress = null,
    appId,
}: LivePreviewProps) {
    const [error, setError] = useState<string | null>(null);
    const [bootPhase, setBootPhase] = useState<string>("Preparing preview…");
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);

    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const bridgeRef = useRef<BridgeController | null>(null);
    const logsRef = useRef<string[]>([]);

    const pushLog = useCallback((line: string) => {
        logsRef.current = [...logsRef.current.slice(-500), line];
        setLogs(logsRef.current);
        onLogsChange?.(logsRef.current);
    }, [onLogsChange]);

    // ─── Live data fetches (unchanged from Sandpack version) ─────────
    const [livePrices, setLivePrices] = useState<Record<string, number>>({});
    const [tokenLogos, setTokenLogos] = useState<Record<string, string>>({});
    const [liveHoldings, setLiveHoldings] = useState<unknown>(null);

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

    const externalModules = useMemo(() => {
        const reactModule = { ...React, default: React };
        const reactDomModule = { ...ReactDOM, default: ReactDOM };
        const reactDomClientModule = { ...ReactDOMClient, default: ReactDOMClient };
        const jsxRuntimeModule = { ...ReactJSXRuntime, default: ReactJSXRuntime };
        const jsxDevRuntimeModule = { ...ReactJSXDevRuntime, default: ReactJSXDevRuntime };
        return {
            react: reactModule,
            "react-dom": reactDomModule,
            "react-dom/client": reactDomClientModule,
            "react/jsx-runtime": jsxRuntimeModule,
            "react/jsx-dev-runtime": jsxDevRuntimeModule,
            "lucide-react": { ...LucideReact, default: LucideReact },
            recharts: { ...Recharts, default: Recharts },
            "framer-motion": { ...FramerMotion, default: FramerMotion },
            "date-fns": { ...DateFns, default: DateFns },
        };
    }, []);

    useEffect(() => {
        window.__dreyvPreviewRuntime = {
            React,
            createRoot: ReactDOMClient.createRoot,
            externals: externalModules,
        };
        return () => {
            delete window.__dreyvPreviewRuntime;
        };
    }, [externalModules]);

    // ─── Compile TSX instantly into an iframe srcdoc ───────────────────
    useEffect(() => {
        let cancelled = false;
        setBootPhase("Compiling preview…");
        setError(null);

        const timer = window.setTimeout(() => {
            try {
                const runtime = buildCompiledRuntime(files);
                if (cancelled) return;
                setPreviewUrl(buildRuntimeHtml(runtime));
                setBootPhase("");
                pushLog("[info] preview compiled");
            } catch (err) {
                if (cancelled) return;
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg);
                setBootPhase("");
                pushLog(`[error] ${msg}`);
            }
        }, 80);

        const timeout = window.setTimeout(() => {
            if (cancelled || previewUrl || error) return;
            setError("Preview compile timed out. Check the code panel for the last compiler message.");
            setBootPhase("");
        }, 8000);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            window.clearTimeout(timeout);
        };
    }, [files, pushLog]);

    // ─── Bind bridge once preview iframe is live ─────────────────────
    useEffect(() => {
        if (!previewUrl || !iframeRef.current) return;

        const fakeRef = { current: iframeRef.current } as React.RefObject<HTMLIFrameElement | null>;
        const bridge = new BridgeController(fakeRef);
        bridgeRef.current = bridge;

        // Console + lifecycle
        bridge.on(BridgeMethods.CONSOLE_LOG,   async (p) => { pushLog(`[info] ${(p as { message?: string }).message}`); return null; });
        bridge.on(BridgeMethods.CONSOLE_WARN,  async (p) => { pushLog(`[warn] ${(p as { message?: string }).message}`); return null; });
        bridge.on(BridgeMethods.CONSOLE_ERROR, async (p) => { pushLog(`[error] ${(p as { message?: string }).message}`); return null; });
        bridge.on(BridgeMethods.RUNTIME_READY, async () => { setError(null); return { status: "ok" }; });
        bridge.on(BridgeMethods.RUNTIME_ERROR, async (p) => {
            const msg = String((p as { message?: string }).message || "Unknown runtime error");
            setError(msg);
            pushLog(`[error] ${msg}`);
            return null;
        });

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

        bridge.on(BridgeMethods.EVENT_EMIT, async (params) => {
            const p = params as { type?: string; payload?: unknown };
            pushLog(`[event] ${p.type}: ${JSON.stringify(p.payload)}`);
            return null;
        });

        // Sovereign OS 2026 mock handlers
        bridge.on(BridgeMethods.LIT_ENCRYPT, async (p) => { const params = p as { plaintext: string; keyId?: string }; pushLog(`[lit] encrypt (keyId: ${params.keyId || "default"})`); return stubLitEncrypt(params); });
        bridge.on(BridgeMethods.LIT_DECRYPT, async (p) => { const params = p as { ciphertext: string; keyId?: string }; pushLog(`[lit] decrypt (keyId: ${params.keyId || "default"})`); return stubLitDecrypt(params); });
        bridge.on(BridgeMethods.ACE_REPORT, async (p) => { pushLog(`[ace] report requested`); return stubACEReport(p as { since?: string }); });
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
        bridge.on(BridgeMethods.MCP_SERVE, async (p) => { pushLog(`[mcp] serve tools: ${((p as { tools?: unknown[] }).tools ?? []).length}`); return null; });
        bridge.on(BridgeMethods.IMPACT_REPORT, async (p) => { pushLog(`[simulation] impact report for tx`); return stubImpactReport(p as { transaction?: unknown }); });
        bridge.on(BridgeMethods.SIWS_SIGN, async () => { pushLog(`[siws] sign-in requested`); return stubSIWSSign(walletAddress ?? null); });
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
        bridge.on(BridgeMethods.TAX_FORENSICS, async (p) => { pushLog(`[tax] forensics requested`); return stubTaxForensics(p as { since?: string }); });

        // Dreyv Connector Gateway
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

        return () => {
            bridge.stop();
            bridgeRef.current = null;
        };
    }, [previewUrl, appId, pushLog, walletAddress]);

    // ─── Inject live data into iframe via postMessage ────────────────
    useEffect(() => {
        if (!previewUrl || !iframeRef.current) return;
        const send = () => {
            try {
                iframeRef.current?.contentWindow?.postMessage({
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
        const t1 = setTimeout(send, 400);
        const t2 = setTimeout(send, 1500);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [previewUrl, livePrices, tokenLogos, liveHoldings, walletAddress]);

    // ─── Console tab UI (unchanged) ──────────────────────────────────
    const [consoleFilter, setConsoleFilter] = useState<"all" | "info" | "warn" | "error" | "event">("all");
    if (tab === "code") {
        const filteredLogs = consoleFilter === "all"
            ? logs
            : logs.filter((log) => {
                if (consoleFilter === "info") return log.startsWith("[info]") || log.startsWith("[npm]") || log.startsWith("[vite]");
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
                    <button onClick={() => { logsRef.current = []; setLogs([]); }} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors uppercase tracking-wider">
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
        <div className="h-full w-full relative bg-white font-manrope">
            {!previewUrl && !error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 transition-opacity duration-300 pointer-events-none">
                    <Loader2 className="w-8 h-8 animate-spin text-violet-600 mb-4" />
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">{bootPhase || "Booting…"}</p>
                    <p className="text-[10px] text-slate-400 mt-2 font-mono">Babel · React · instant runtime</p>
                </div>
            )}
            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 z-20 p-8 backdrop-blur-sm">
                    <div className="bg-red-50 border border-red-200 p-6 rounded-3xl max-w-md w-full">
                        <div className="flex items-center gap-3 mb-3 text-red-600">
                            <AlertTriangle className="w-5 h-5" />
                            <span className="font-bold uppercase tracking-wider text-xs">Runtime Error</span>
                        </div>
                        <p className="text-sm text-slate-700 font-mono break-words leading-relaxed">{error}</p>
                    </div>
                    <button
                        onClick={() => { setError(null); window.location.reload(); }}
                        className="mt-6 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-full uppercase tracking-wider transition-colors"
                    >
                        Reload Runtime
                    </button>
                </div>
            )}
            {previewUrl && (
                <iframe
                    ref={iframeRef}
                    srcDoc={previewUrl}
                    title="Dreyv Mini-App Preview"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    style={{ height: "100%", width: "100%", border: "none", background: "#ffffff" }}
                />
            )}
        </div>
    );
}
