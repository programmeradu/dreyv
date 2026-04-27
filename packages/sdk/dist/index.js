"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AppEventBus: () => AppEventBus,
  BridgeMethods: () => BridgeMethods,
  setBridge: () => setBridge,
  toBlink: () => toBlink,
  useACEReport: () => useACEReport,
  useAgentHandoff: () => useAgentHandoff,
  useEncryptedSecret: () => useEncryptedSecret,
  useFetch: () => useFetch,
  useGaslessTx: () => useGaslessTx,
  useImpactReport: () => useImpactReport,
  useJupiterSwap: () => useJupiterSwap,
  useMCPClient: () => useMCPClient,
  useMCPServer: () => useMCPServer,
  useNotification: () => useNotification,
  usePortfolio: () => usePortfolio,
  useSIWS: () => useSIWS,
  useStorage: () => useStorage,
  useTaxForensics: () => useTaxForensics,
  useTheme: () => useTheme,
  useTokenPrice: () => useTokenPrice,
  useVault: () => useVault,
  useYieldOptimizer: () => useYieldOptimizer,
  verifyZKSP: () => verifyZKSP
});
module.exports = __toCommonJS(index_exports);

// src/hooks/useVault.ts
var import_react = require("react");
var DEFAULT_VAULT = {
  activeVault: "Main Portfolio",
  balances: { SOL: 124.5, USDC: 5400.2 },
  tokens: [
    { symbol: "SOL", name: "Solana", balance: 124.5, price: 23.4 },
    { symbol: "USDC", name: "USD Coin", balance: 5400.2, price: 1 },
    { symbol: "BONK", name: "Bonk", balance: 15e6, price: 24e-6 },
    { symbol: "JUP", name: "Jupiter", balance: 850, price: 1.12 }
  ]
};
function useVault() {
  return (0, import_react.useMemo)(() => ({ ...DEFAULT_VAULT }), []);
}

// src/hooks/useFetch.ts
var import_react2 = require("react");

// src/bridge-context.ts
var bridgeInstance = null;
function setBridge(bridge) {
  bridgeInstance = bridge;
}
function getBridge() {
  if (bridgeInstance) return bridgeInstance;
  const global = typeof globalThis !== "undefined" ? globalThis : window;
  const b = global.keystoneBridge;
  if (!b) {
    throw new Error(
      "[@keystone-os/sdk] No bridge. Call setBridge() or ensure host injects keystoneBridge."
    );
  }
  return b;
}

// src/bridge.ts
var BridgeMethods = {
  // Core
  PROXY_REQUEST: "proxy.fetch",
  EVENT_EMIT: "event.emit",
  // Sovereign OS 2026
  LIT_ENCRYPT: "lit.encryptSecret",
  LIT_DECRYPT: "lit.decryptSecret",
  ACE_REPORT: "ace.report",
  ZKSP_VERIFY: "zksp.verify",
  AGENT_HANDOFF: "agent.handoff",
  MCP_CALL: "mcp.call",
  MCP_SERVE: "mcp.serve",
  IMPACT_REPORT: "simulation.impactReport",
  SIWS_SIGN: "siws.sign",
  SIWS_VERIFY: "siws.verify",
  JUPITER_SWAP: "jupiter.swap",
  JUPITER_QUOTE: "jupiter.quote",
  YIELD_OPTIMIZE: "yield.optimize",
  GASLESS_SUBMIT: "gasless.submit",
  BLINK_EXPORT: "blink.export",
  TAX_FORENSICS: "tax.forensics"
};

// src/hooks/useFetch.ts
function useFetch(url, options = {}) {
  const [data, setData] = (0, import_react2.useState)(null);
  const [error, setError] = (0, import_react2.useState)(null);
  const [loading, setLoading] = (0, import_react2.useState)(true);
  const fetchData = (0, import_react2.useCallback)(async () => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const result = await bridge.call(BridgeMethods.PROXY_REQUEST, {
        url,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        body: options.body,
        observability: options.observability
      });
      setData(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [url, options.method, options.body]);
  (0, import_react2.useEffect)(() => {
    fetchData();
  }, [fetchData]);
  return { data, error, loading, refetch: fetchData };
}

// src/hooks/AppEventBus.ts
var AppEventBus = {
  emit: (type, payload) => {
    getBridge().notify(BridgeMethods.EVENT_EMIT, { type, payload });
  }
};

// src/hooks/useEncryptedSecret.ts
var import_react3 = require("react");
function useEncryptedSecret() {
  const [loading, setLoading] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const encrypt = (0, import_react3.useCallback)(async (plaintext, keyId) => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const result = await bridge.call(BridgeMethods.LIT_ENCRYPT, {
        plaintext,
        keyId: keyId ?? "default"
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);
  const decrypt = (0, import_react3.useCallback)(async (ciphertext, keyId) => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const result = await bridge.call(BridgeMethods.LIT_DECRYPT, {
        ciphertext,
        keyId: keyId ?? "default"
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);
  return { encrypt, decrypt, loading, error };
}

// src/hooks/useACEReport.ts
var import_react4 = require("react");
function useACEReport(options) {
  const [report, setReport] = (0, import_react4.useState)([]);
  const [loading, setLoading] = (0, import_react4.useState)(true);
  const [error, setError] = (0, import_react4.useState)(null);
  const fetchReport = (0, import_react4.useCallback)(async () => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const result = await bridge.call(BridgeMethods.ACE_REPORT, {
        since: options?.since?.toISOString()
      });
      setReport(result ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setReport([]);
    } finally {
      setLoading(false);
    }
  }, [options?.since?.toISOString()]);
  (0, import_react4.useEffect)(() => {
    fetchReport();
  }, [fetchReport]);
  return { report, loading, error, refetch: fetchReport };
}

// src/hooks/useAgentHandoff.ts
var import_react5 = require("react");
function useAgentHandoff(fromAgent) {
  const handoffTo = (0, import_react5.useCallback)(
    async (toAgent, context) => {
      const bridge = getBridge();
      const payload = {
        fromAgent,
        toAgent,
        context
      };
      return bridge.call(BridgeMethods.AGENT_HANDOFF, payload);
    },
    [fromAgent]
  );
  return { handoffTo };
}

// src/hooks/useMCPClient.ts
var import_react6 = require("react");
function useMCPClient(serverUrl) {
  const [loading, setLoading] = (0, import_react6.useState)(false);
  const [error, setError] = (0, import_react6.useState)(null);
  const call = (0, import_react6.useCallback)(
    async (tool, params = {}) => {
      setLoading(true);
      setError(null);
      try {
        const bridge = getBridge();
        return await bridge.call(BridgeMethods.MCP_CALL, {
          serverUrl,
          tool,
          params
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [serverUrl]
  );
  return { call, loading, error };
}

// src/hooks/useMCPServer.ts
var import_react7 = require("react");
function useMCPServer(tools, handlers) {
  const registerTools = (0, import_react7.useCallback)(() => {
    getBridge().notify(BridgeMethods.MCP_SERVE, { tools });
  }, [tools]);
  const handleCall = (0, import_react7.useCallback)(
    async (tool, params) => {
      const handler = handlers[tool];
      if (!handler) throw new Error(`Unknown MCP tool: ${tool}`);
      return handler(params);
    },
    [handlers]
  );
  return { registerTools, handleCall };
}

// src/hooks/useSIWS.ts
var import_react8 = require("react");
function useSIWS() {
  const [session, setSession] = (0, import_react8.useState)(null);
  const signIn = (0, import_react8.useCallback)(async () => {
    const bridge = getBridge();
    const result = await bridge.call(BridgeMethods.SIWS_SIGN, {});
    if (result?.address) {
      setSession({ address: result.address, chainId: result.chainId });
    }
    return { message: result?.message ?? "", signature: result?.signature ?? "" };
  }, []);
  const verify = (0, import_react8.useCallback)(async (message, signature) => {
    const bridge = getBridge();
    const result = await bridge.call(BridgeMethods.SIWS_VERIFY, {
      message,
      signature
    });
    return result ?? false;
  }, []);
  return { signIn, verify, session };
}

// src/hooks/useJupiterSwap.ts
var import_react9 = require("react");
function useJupiterSwap() {
  const [loading, setLoading] = (0, import_react9.useState)(false);
  const [error, setError] = (0, import_react9.useState)(null);
  const getQuote = (0, import_react9.useCallback)(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const result = await bridge.call(BridgeMethods.JUPITER_QUOTE, params);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  const swap = (0, import_react9.useCallback)(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const result = await bridge.call(BridgeMethods.JUPITER_SWAP, params);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);
  return { swap, getQuote, loading, error };
}

// src/hooks/useImpactReport.ts
var import_react10 = require("react");
function useImpactReport() {
  const [report, setReport] = (0, import_react10.useState)(null);
  const [loading, setLoading] = (0, import_react10.useState)(false);
  const [error, setError] = (0, import_react10.useState)(null);
  const simulate = (0, import_react10.useCallback)(async (transaction) => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const result = await bridge.call(BridgeMethods.IMPACT_REPORT, {
        transaction
      });
      setReport(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);
  return { report, loading, error, simulate };
}

// src/hooks/useTaxForensics.ts
var import_react11 = require("react");
function useTaxForensics(options) {
  const [result, setResult] = (0, import_react11.useState)(null);
  const [loading, setLoading] = (0, import_react11.useState)(true);
  const [error, setError] = (0, import_react11.useState)(null);
  const fetchResult = (0, import_react11.useCallback)(async () => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const data = await bridge.call(BridgeMethods.TAX_FORENSICS, {
        since: options?.since?.toISOString()
      });
      setResult(data ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [options?.since?.toISOString()]);
  (0, import_react11.useEffect)(() => {
    fetchResult();
  }, [fetchResult]);
  return { result, loading, error, refetch: fetchResult };
}

// src/hooks/useYieldOptimizer.ts
var import_react12 = require("react");
function useYieldOptimizer(asset) {
  const [paths, setPaths] = (0, import_react12.useState)([]);
  const [loading, setLoading] = (0, import_react12.useState)(true);
  const [error, setError] = (0, import_react12.useState)(null);
  const fetchPaths = (0, import_react12.useCallback)(async () => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const result = await bridge.call(BridgeMethods.YIELD_OPTIMIZE, {
        asset
      });
      setPaths(result ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPaths([]);
    } finally {
      setLoading(false);
    }
  }, [asset]);
  (0, import_react12.useEffect)(() => {
    fetchPaths();
  }, [fetchPaths]);
  return { paths, loading, error, refetch: fetchPaths };
}

// src/hooks/useGaslessTx.ts
var import_react13 = require("react");
function useGaslessTx() {
  const [loading, setLoading] = (0, import_react13.useState)(false);
  const [error, setError] = (0, import_react13.useState)(null);
  const submit = (0, import_react13.useCallback)(async (transaction, description) => {
    setLoading(true);
    setError(null);
    try {
      const bridge = getBridge();
      const result = await bridge.call(BridgeMethods.GASLESS_SUBMIT, {
        transaction,
        description: description ?? "Gasless transaction"
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);
  return { submit, loading, error };
}

// src/hooks/usePortfolio.ts
var import_react14 = require("react");
function usePortfolio() {
  const vault = useVault();
  const data = (0, import_react14.useMemo)(() => {
    const totalValue = vault.tokens.reduce(
      (sum, t) => sum + t.balance * t.price,
      0
    );
    const tokens = vault.tokens.map((t) => ({
      ...t,
      usdValue: t.balance * t.price,
      percentage: totalValue > 0 ? t.balance * t.price / totalValue * 100 : 0
    }));
    return {
      tokens,
      totalValue,
      change24h: 0,
      changePercent24h: 0
    };
  }, [vault.tokens]);
  return {
    data,
    isLoading: false,
    error: null,
    refetch: () => {
    }
  };
}

// src/hooks/useTheme.ts
var import_react15 = require("react");
function useTheme() {
  const [theme, setThemeState] = (0, import_react15.useState)("dark");
  const isDark = theme === "dark" || theme === "system" && true;
  const toggleTheme = (0, import_react15.useCallback)(() => {
    setThemeState((prev) => prev === "dark" ? "light" : "dark");
  }, []);
  const setTheme = (0, import_react15.useCallback)((newTheme) => {
    setThemeState(newTheme);
  }, []);
  return { isDark, theme, toggleTheme, setTheme };
}

// src/hooks/useTokenPrice.ts
var import_react16 = require("react");
var DEFAULT_PRICES = {
  So11111111111111111111111111111111111111112: 23.4,
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1,
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 24e-6,
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 1.12,
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 26.8
};
function useTokenPrice(mint) {
  const [price, setPrice] = (0, import_react16.useState)(DEFAULT_PRICES[mint] ?? null);
  const [loading, setLoading] = (0, import_react16.useState)(false);
  const [error, setError] = (0, import_react16.useState)(null);
  const refetch = (0, import_react16.useCallback)(() => {
    if (!mint) return;
    setLoading(true);
    setError(null);
    fetch(`https://api.jup.ag/price/v2?ids=${mint}`).then((r) => r.json()).then((data) => {
      const p = data?.data?.[mint]?.price;
      if (p) setPrice(Number(p));
      else setPrice(DEFAULT_PRICES[mint] ?? 0);
    }).catch((e) => {
      setError(e.message);
      setPrice(DEFAULT_PRICES[mint] ?? 0);
    }).finally(() => setLoading(false));
  }, [mint]);
  (0, import_react16.useEffect)(() => {
    refetch();
  }, [refetch]);
  return { price, loading, error, refetch };
}

// src/hooks/useNotification.ts
var import_react17 = require("react");
function useNotification() {
  const [notifications, setNotifications] = (0, import_react17.useState)([]);
  const send = (0, import_react17.useCallback)(
    (title, options) => {
      const id = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const notif = {
        id,
        type: options?.type || "info",
        title,
        message: options?.message,
        timestamp: Date.now(),
        read: false
      };
      setNotifications((prev) => [notif, ...prev]);
      return id;
    },
    []
  );
  const dismiss = (0, import_react17.useCallback)((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);
  const markRead = (0, import_react17.useCallback)((id) => {
    setNotifications(
      (prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n)
    );
  }, []);
  const clearAll = (0, import_react17.useCallback)(() => {
    setNotifications([]);
  }, []);
  const unreadCount = notifications.filter((n) => !n.read).length;
  return { notifications, send, dismiss, markRead, clearAll, unreadCount };
}

// src/hooks/useStorage.ts
var import_react18 = require("react");
var STORAGE_PREFIX = "ks_app_";
function useStorage(namespace) {
  const prefix = namespace ? `${STORAGE_PREFIX}${namespace}_` : STORAGE_PREFIX;
  const [, setTick] = (0, import_react18.useState)(0);
  const bump = (0, import_react18.useCallback)(() => setTick((t) => t + 1), []);
  const get = (0, import_react18.useCallback)(
    (key) => {
      try {
        return localStorage.getItem(`${prefix}${key}`);
      } catch {
        return null;
      }
    },
    [prefix]
  );
  const set = (0, import_react18.useCallback)(
    (key, value) => {
      try {
        localStorage.setItem(`${prefix}${key}`, value);
        bump();
      } catch (e) {
        console.warn("[useStorage] Failed to set:", e);
      }
    },
    [prefix, bump]
  );
  const remove = (0, import_react18.useCallback)(
    (key) => {
      try {
        localStorage.removeItem(`${prefix}${key}`);
        bump();
      } catch {
      }
    },
    [prefix, bump]
  );
  const keys = (0, import_react18.useCallback)(() => {
    try {
      const result = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) {
          result.push(k.slice(prefix.length));
        }
      }
      return result;
    } catch {
      return [];
    }
  }, [prefix]);
  const clear = (0, import_react18.useCallback)(() => {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
      bump();
    } catch {
    }
  }, [prefix, bump]);
  return { get, set, remove, keys, clear };
}

// src/utils/toBlink.ts
async function toBlink(action) {
  const bridge = getBridge();
  const result = await bridge.call(BridgeMethods.BLINK_EXPORT, {
    label: action.label,
    payload: action.payload,
    type: action.type ?? "custom"
  });
  return result;
}

// src/utils/zksp.ts
async function verifyZKSP(params) {
  try {
    const bridge = getBridge();
    const result = await bridge.call(BridgeMethods.ZKSP_VERIFY, params);
    return result ?? { verified: false };
  } catch {
    return { verified: false };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AppEventBus,
  BridgeMethods,
  setBridge,
  toBlink,
  useACEReport,
  useAgentHandoff,
  useEncryptedSecret,
  useFetch,
  useGaslessTx,
  useImpactReport,
  useJupiterSwap,
  useMCPClient,
  useMCPServer,
  useNotification,
  usePortfolio,
  useSIWS,
  useStorage,
  useTaxForensics,
  useTheme,
  useTokenPrice,
  useVault,
  useYieldOptimizer,
  verifyZKSP
});
