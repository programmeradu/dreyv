/**
 * Project Templates for Keystone Studio.
 *
 * Starter templates that demonstrate REAL API integration patterns.
 * All templates use useFetch() to hit live endpoints — no mock data.
 *
 * [P3] — Project Templates Gallery
 */

/** Use cases group templates by treasury intent in the gallery sidebar. */
export type TemplateUseCase =
    | "treasury-monitoring"
    | "market-data"
    | "team-comms"
    | "defi-operations"
    | "ai-agents";

export interface ProjectTemplate {
    id: string;
    name: string;
    description: string;
    /** Free-form label, kept for backwards compat. */
    category: string;
    /** New — drives the gallery left-rail grouping. */
    useCase: TemplateUseCase;
    /** Provider IDs from the Dreyv gateway this template calls (e.g. ["helius","slack"]). */
    requiredProviders: string[];
    icon: string;
    files: Record<string, string>;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
    {
        id: "defi-dashboard",
        name: "DeFi Dashboard",
        description: "Real-time portfolio tracker with live Jupiter prices and auto-refresh",
        category: "Finance",
        icon: "\u{1F4CA}",
        files: {
            "App.tsx": `import { useVault, useFetch } from '@keystone-os/sdk';
import { useState, useEffect, useRef } from 'react';

const MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
};

const ids = Object.values(MINTS).join(',');

export default function App() {
  const { tokens, activeVault } = useVault();
  const { data: priceData, loading, refetch } = useFetch(
    'https://lite-api.jup.ag/price/v2?ids=' + ids
  );
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const prevPrices = useRef<Record<string, number>>({});
  const [changes, setChanges] = useState<Record<string, number>>({});

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const id = setInterval(() => {
      refetch();
      setLastUpdate(new Date());
    }, 10000);
    return () => clearInterval(id);
  }, [refetch]);

  // Track price changes
  useEffect(() => {
    if (!priceData?.data) return;
    const newChanges: Record<string, number> = {};
    for (const [sym, mint] of Object.entries(MINTS)) {
      const price = Number(priceData.data[mint]?.price || 0);
      const prev = prevPrices.current[sym];
      if (prev && prev !== 0) {
        newChanges[sym] = ((price - prev) / prev) * 100;
      }
      prevPrices.current[sym] = price;
    }
    setChanges(newChanges);
  }, [priceData]);

  const getPrice = (mint: string) => Number(priceData?.data?.[mint]?.price || 0);

  const totalValue = tokens.reduce((sum, t) => {
    const price = getPrice(MINTS[t.symbol as keyof typeof MINTS] || '') || t.price;
    return sum + t.balance * price;
  }, 0);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Portfolio Dashboard</h1>
          <p className="text-zinc-500 text-sm mt-1">{activeVault}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-emerald-400">
            \${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-zinc-500">
            {loading ? 'Updating...' : \`Live • \${lastUpdate.toLocaleTimeString()}\`}
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        {tokens.map((token) => {
          const mint = MINTS[token.symbol as keyof typeof MINTS] || '';
          const livePrice = getPrice(mint) || token.price;
          const value = token.balance * livePrice;
          const change = changes[token.symbol] || 0;

          return (
            <div key={token.symbol} className="flex items-center justify-between p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-emerald-400/20 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-bold text-zinc-400">
                  {token.symbol[0]}
                </div>
                <div>
                  <p className="font-bold text-white">{token.symbol}</p>
                  <p className="text-xs text-zinc-500">{token.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono font-bold text-white">\${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</p>
                {change !== 0 && (
                  <p className={\`text-xs font-mono \${change > 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                    {change > 0 ? '+' : ''}{change.toFixed(2)}%
                  </p>
                )}
              </div>
              <div className="text-right w-32">
                <p className="font-mono text-zinc-300">{token.balance.toLocaleString()}</p>
                <p className="text-xs text-emerald-400">\${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 text-center text-[10px] text-zinc-600">
        Live data from Jupiter Price API • Auto-refreshes every 10s
      </div>
    </div>
  );
}`,
        },
    },
    {
        id: "token-swap",
        name: "Token Swap",
        description: "Jupiter-powered swap with real quotes and route visualization",
        category: "DeFi",
        icon: "\u{1F504}",
        files: {
            "App.tsx": `import { useVault, useFetch, useJupiterSwap } from '@keystone-os/sdk';
import { useState, useEffect } from 'react';

const TOKENS = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
  { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6 },
];

export default function App() {
  const { tokens } = useVault();
  const { swap, loading: swapLoading } = useJupiterSwap();
  const [inputIdx, setInputIdx] = useState(0);
  const [outputIdx, setOutputIdx] = useState(1);
  const [amount, setAmount] = useState('1');
  const [quoteResult, setQuoteResult] = useState<any>(null);

  const inputToken = TOKENS[inputIdx];
  const outputToken = TOKENS[outputIdx];
  const amountLamports = String(Math.floor(Number(amount) * Math.pow(10, inputToken.decimals)));

  // Fetch real Jupiter quote
  const quoteUrl = Number(amount) > 0
    ? \`https://lite-api.jup.ag/swap/v1/quote?inputMint=\${inputToken.mint}&outputMint=\${outputToken.mint}&amount=\${amountLamports}&slippageBps=50\`
    : '';
  const { data: quote, loading: quoteLoading, refetch: refetchQuote } = useFetch(quoteUrl || 'about:blank');

  useEffect(() => {
    if (quote && !quote.error) setQuoteResult(quote);
  }, [quote]);

  const outputAmount = quoteResult?.outAmount
    ? (Number(quoteResult.outAmount) / Math.pow(10, outputToken.decimals)).toFixed(6)
    : '—';

  const priceImpact = quoteResult?.priceImpactPct
    ? (Number(quoteResult.priceImpactPct) * 100).toFixed(3)
    : null;

  const handleSwap = async () => {
    if (!quoteResult) return;
    await swap({
      inputMint: inputToken.mint,
      outputMint: outputToken.mint,
      amount: amountLamports,
      slippageBps: 50,
    });
  };

  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Token Swap</h1>

      <div className="space-y-4 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div>
          <label className="text-xs text-zinc-500 uppercase tracking-wider font-bold block mb-2">From</label>
          <div className="flex gap-2">
            <select value={inputIdx} onChange={(e) => setInputIdx(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 text-white text-sm">
              {TOKENS.map((t, i) => <option key={t.mint} value={i}>{t.symbol}</option>)}
            </select>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="0.01"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 text-white text-sm font-mono" />
          </div>
        </div>

        <div className="flex justify-center">
          <button onClick={() => { setInputIdx(outputIdx); setOutputIdx(inputIdx); }}
            className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors">
            ↕
          </button>
        </div>

        <div>
          <label className="text-xs text-zinc-500 uppercase tracking-wider font-bold block mb-2">To</label>
          <div className="flex gap-2 items-center">
            <select value={outputIdx} onChange={(e) => setOutputIdx(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 text-white text-sm">
              {TOKENS.map((t, i) => <option key={t.mint} value={i}>{t.symbol}</option>)}
            </select>
            <p className="flex-1 text-right text-lg font-mono font-bold text-white">
              {quoteLoading ? '...' : outputAmount}
            </p>
          </div>
        </div>

        {quoteResult && (
          <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1">
            {priceImpact && (
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Price Impact</span>
                <span className={Number(priceImpact) > 1 ? 'text-red-400' : 'text-zinc-300'}>{priceImpact}%</span>
              </div>
            )}
            {quoteResult.routePlan && (
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Route</span>
                <span className="text-zinc-300">{quoteResult.routePlan.map((r: any) => r.swapInfo?.label).join(' → ')}</span>
              </div>
            )}
          </div>
        )}

        <button onClick={handleSwap} disabled={swapLoading || !quoteResult}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg text-sm font-bold text-white transition-colors">
          {swapLoading ? 'Processing...' : 'Swap'}
        </button>
      </div>

      <div className="mt-4 text-center text-[10px] text-zinc-600">
        Real quotes from Jupiter Aggregator API
      </div>
    </div>
  );
}`,
        },
    },
    {
        id: "vault-manager",
        name: "Vault Manager",
        description: "Treasury management with live prices, signing, and impact simulation",
        category: "Treasury",
        icon: "\u{1F3E6}",
        files: {
            "App.tsx": `import { useVault, useTurnkey, useImpactReport, useFetch } from '@keystone-os/sdk';
import { useState, useEffect } from 'react';

const MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
};

export default function App() {
  const { tokens, activeVault } = useVault();
  const { getPublicKey, signTransaction } = useTurnkey();
  const { simulate } = useImpactReport();
  const [publicKey, setPublicKey] = useState('');
  const [lastAction, setLastAction] = useState('');

  // Live prices from Jupiter
  const ids = Object.values(MINTS).join(',');
  const { data: priceData, refetch } = useFetch('https://lite-api.jup.ag/price/v2?ids=' + ids);

  useEffect(() => {
    const id = setInterval(refetch, 15000);
    return () => clearInterval(id);
  }, [refetch]);

  const getPrice = (symbol: string) => {
    const mint = MINTS[symbol as keyof typeof MINTS];
    return mint ? Number(priceData?.data?.[mint]?.price || 0) : 0;
  };

  const totalValue = tokens.reduce((sum, t) => sum + t.balance * (getPrice(t.symbol) || t.price), 0);

  const handleConnect = async () => {
    const pk = await getPublicKey();
    setPublicKey(pk);
    setLastAction('Connected: ' + pk);
  };

  const handleSign = async () => {
    const result = await signTransaction({}, 'Test transaction sign');
    setLastAction('Signed: ' + result.signature);
  };

  const handleSimulate = async () => {
    const report = await simulate({ type: 'transfer', amount: 1 });
    setLastAction('Simulation complete — ' + JSON.stringify(report.diff || []));
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
          <h1 className="text-2xl font-bold text-white">Vault Manager</h1>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-emerald-400">\${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{activeVault}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <button onClick={handleConnect} className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-emerald-400/30 transition-all">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold mb-1">Connect</p>
          <p className="text-sm text-white font-mono">{publicKey ? publicKey.slice(0, 8) + '...' : 'Not connected'}</p>
        </button>
        <button onClick={handleSign} className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-purple-400/30 transition-all">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold mb-1">Sign TX</p>
          <p className="text-sm text-white">Turnkey</p>
        </button>
        <button onClick={handleSimulate} className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-cyan-400/30 transition-all">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-bold mb-1">Simulate</p>
          <p className="text-sm text-white">Firewall</p>
        </button>
      </div>

      {lastAction && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 mb-8">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mb-1">Last Action</p>
          <p className="text-xs text-emerald-400 font-mono break-all">{lastAction}</p>
        </div>
      )}

      <div className="space-y-2">
        {tokens.map((t) => {
          const livePrice = getPrice(t.symbol) || t.price;
          return (
            <div key={t.symbol} className="flex items-center justify-between p-3 bg-zinc-900/40 border border-zinc-800/50 rounded-lg">
              <span className="font-bold text-white">{t.symbol}</span>
              <span className="font-mono text-zinc-400">{t.balance.toLocaleString()}</span>
              <span className="font-mono text-zinc-500 text-sm">\${livePrice.toFixed(4)}</span>
              <span className="text-emerald-400 text-sm">\${(t.balance * livePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-6 text-center text-[10px] text-zinc-600">
        Live prices from Jupiter • Auto-refreshes every 15s
      </div>
    </div>
  );
}`,
        },
    },
    {
        id: "data-fetcher",
        name: "Live Data App",
        description: "Real-time DexScreener data with auto-refresh and price alerts",
        category: "Data",
        icon: "\u{1F310}",
        files: {
            "App.tsx": `import { useFetch } from '@keystone-os/sdk';
import { useState, useEffect, useRef } from 'react';

const TOKENS = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
];

interface Alert {
  symbol: string;
  price: string;
  change: number;
  time: Date;
}

export default function App() {
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertThreshold, setAlertThreshold] = useState(0.5);
  const prevPrice = useRef<number | null>(null);

  // Real DexScreener data
  const { data: dexData, loading, refetch } = useFetch(
    'https://api.dexscreener.com/latest/dex/tokens/' + selectedToken.mint
  );

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const id = setInterval(refetch, 10000);
    return () => clearInterval(id);
  }, [refetch]);

  // Price alert logic
  const topPair = dexData?.pairs?.[0];
  const price = topPair?.priceUsd ? Number(topPair.priceUsd) : null;

  useEffect(() => {
    if (price === null) return;
    if (prevPrice.current !== null) {
      const changePct = ((price - prevPrice.current) / prevPrice.current) * 100;
      if (Math.abs(changePct) >= alertThreshold) {
        setAlerts(a => [...a.slice(-10), {
          symbol: selectedToken.symbol,
          price: price.toFixed(6),
          change: changePct,
          time: new Date(),
        }]);
      }
    }
    prevPrice.current = price;
  }, [price, alertThreshold, selectedToken.symbol]);

  // Reset prev price when token changes
  useEffect(() => { prevPrice.current = null; }, [selectedToken.mint]);

  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">Live Market Data</h1>
      <p className="text-zinc-500 text-sm mb-8">Real-time from DexScreener with price alerts</p>

      <div className="flex gap-2 mb-6">
        {TOKENS.map((t) => (
          <button key={t.symbol} onClick={() => setSelectedToken(t)}
            className={\`px-4 py-2 rounded-lg text-sm font-bold transition-all \${
              selectedToken.symbol === t.symbol
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
            }\`}>
            {t.symbol}
          </button>
        ))}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-4">
        {loading && !topPair ? (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">Fetching live data...</p>
          </div>
        ) : topPair ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-3xl font-bold text-white">\${Number(topPair.priceUsd).toFixed(6)}</p>
                <p className="text-zinc-500 text-sm">{topPair.baseToken?.symbol}/{topPair.quoteToken?.symbol}</p>
              </div>
              <div className="text-right">
                <p className={\`text-lg font-bold \${Number(topPair.priceChange?.h24) >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                  {Number(topPair.priceChange?.h24) >= 0 ? '+' : ''}{Number(topPair.priceChange?.h24).toFixed(2)}%
                </p>
                <p className="text-[10px] text-zinc-500 uppercase">24h change</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-zinc-800/50 rounded-lg p-2">
                <p className="text-[10px] text-zinc-500 uppercase mb-1">Volume 24h</p>
                <p className="text-sm font-mono text-white">\${Number(topPair.volume?.h24 || 0).toLocaleString()}</p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-2">
                <p className="text-[10px] text-zinc-500 uppercase mb-1">Liquidity</p>
                <p className="text-sm font-mono text-white">\${Number(topPair.liquidity?.usd || 0).toLocaleString()}</p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-2">
                <p className="text-[10px] text-zinc-500 uppercase mb-1">DEX</p>
                <p className="text-sm font-mono text-white">{topPair.dexId}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-zinc-500 text-center py-8">No pair data found</p>
        )}
      </div>

      {/* Alert threshold */}
      <div className="flex items-center gap-3 mb-4 bg-zinc-900 border border-zinc-800 rounded-xl p-3">
        <span className="text-xs text-zinc-500 uppercase font-bold">Alert at</span>
        <input type="number" value={alertThreshold} onChange={(e) => setAlertThreshold(Number(e.target.value))}
          step="0.1" min="0.1" className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-white font-mono" />
        <span className="text-xs text-zinc-500">% change</span>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mb-2">Alerts</p>
          {alerts.slice().reverse().map((a, i) => (
            <div key={i} className={\`flex items-center justify-between px-3 py-2 rounded-lg text-xs \${
              a.change > 0 ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'
            }\`}>
              <span className="font-bold text-white">{a.symbol}</span>
              <span className="font-mono text-zinc-300">\${a.price}</span>
              <span className={\`font-mono \${a.change > 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
                {a.change > 0 ? '+' : ''}{a.change.toFixed(3)}%
              </span>
              <span className="text-zinc-600">{a.time.toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 text-center text-[10px] text-zinc-600">
        Live data from DexScreener API • Auto-refreshes every 10s
      </div>
    </div>
  );
}`,
        },
    },
    {
        id: "mcp-agent",
        name: "MCP Agent Hub",
        description: "Connect to MCP servers and orchestrate agent handoffs",
        category: "AI",
        icon: "\u{1F916}",
        files: {
            "App.tsx": `import { useMCPClient, useAgentHandoff, AppEventBus } from '@keystone-os/sdk';
import { useState } from 'react';

export default function App() {
  const mcp = useMCPClient('https://mcp.example.com');
  const { handoffTo } = useAgentHandoff('orchestrator');
  const [results, setResults] = useState<any[]>([]);
  const [status, setStatus] = useState('idle');

  const handleMCPCall = async (tool: string) => {
    setStatus('calling ' + tool + '...');
    try {
      const result = await mcp.call(tool, { query: 'SOL price analysis' });
      setResults(prev => [...prev, { tool, result, ts: Date.now() }]);
      AppEventBus.emit('mcp.call.complete', { tool, result });
      setStatus('done');
    } catch (err: any) {
      setStatus('error: ' + err.message);
    }
  };

  const handleHandoff = async (agent: string) => {
    setStatus('handing off to ' + agent + '...');
    const result = await handoffTo(agent, { context: 'portfolio analysis', data: results });
    setStatus('handoff complete: ' + JSON.stringify(result));
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">MCP Agent Hub</h1>
      <p className="text-zinc-500 text-sm mb-8">Connect to MCP servers and orchestrate AI agents</p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <button onClick={() => handleMCPCall('search')}
          className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl hover:bg-purple-500/20 transition-all text-left">
          <p className="text-sm font-bold text-purple-400">MCP: Search</p>
          <p className="text-xs text-zinc-500 mt-1">Call search tool on MCP server</p>
        </button>
        <button onClick={() => handleMCPCall('analyze')}
          className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-xl hover:bg-cyan-500/20 transition-all text-left">
          <p className="text-sm font-bold text-cyan-400">MCP: Analyze</p>
          <p className="text-xs text-zinc-500 mt-1">Call analyze tool on MCP server</p>
        </button>
        <button onClick={() => handleHandoff('analyst')}
          className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl hover:bg-amber-500/20 transition-all text-left">
          <p className="text-sm font-bold text-amber-400">Handoff: Analyst</p>
          <p className="text-xs text-zinc-500 mt-1">Transfer context to analyst agent</p>
        </button>
        <button onClick={() => handleHandoff('executor')}
          className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl hover:bg-emerald-500/20 transition-all text-left">
          <p className="text-sm font-bold text-emerald-400">Handoff: Executor</p>
          <p className="text-xs text-zinc-500 mt-1">Transfer context to executor agent</p>
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mb-2">Status</p>
        <p className="text-sm text-emerald-400 font-mono">{status}</p>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Results</p>
          {results.map((r, i) => (
            <div key={i} className="bg-zinc-800/50 rounded-lg p-3 text-xs font-mono text-zinc-400">
              <span className="text-purple-400">[{r.tool}]</span> {JSON.stringify(r.result)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}`,
        },
    },

    // ─────────────────────────────────────────────────────────────────
    // Dreyv Connector Gateway templates — call third-party APIs through
    // window.dreyv with the user's encrypted credentials.
    // ─────────────────────────────────────────────────────────────────

    {
        id: "helius-wallet-inspector",
        name: "Helius Wallet Inspector",
        description: "Inspect any Solana wallet's NFTs and SPL holdings via Helius DAS",
        category: "Dreyv Gateway",
        icon: "\u{1F50D}",
        files: {
            "App.tsx": `import { useState } from 'react';

declare const dreyv: any;

export default function App() {
  const [addr, setAddr] = useState('');
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function inspect() {
    if (!addr) return;
    setLoading(true); setError('');
    try {
      const res = await dreyv.helius.getAssetsByOwner({
        ownerAddress: addr, page: 1, limit: 50,
      });
      setAssets(res?.result?.items || []);
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white">Helius Wallet Inspector</h1>
      <div className="flex gap-2">
        <input value={addr} onChange={e => setAddr(e.target.value)}
          placeholder="Solana wallet address"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white" />
        <button onClick={inspect} disabled={loading}
          className="bg-violet-600 hover:bg-violet-500 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50">
          {loading ? 'Scanning…' : 'Inspect'}
        </button>
      </div>
      {error && <div className="text-rose-400 text-sm">{error}</div>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {assets.map((a, i) => (
          <div key={i} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs font-mono text-zinc-500 truncate">{a.id}</div>
            <div className="text-sm text-white mt-1 truncate">{a.content?.metadata?.name || 'Unnamed'}</div>
          </div>
        ))}
      </div>
      {!loading && assets.length === 0 && addr && !error && (
        <div className="text-zinc-500 text-sm">No assets found.</div>
      )}
    </div>
  );
}`,
        },
    },

    {
        id: "jupiter-swap-quote",
        name: "Jupiter Swap Quote",
        description: "Get real-time SOL/USDC swap quotes via Jupiter v6 (no key needed)",
        category: "Dreyv Gateway",
        icon: "\u{1F504}",
        files: {
            "App.tsx": `import { useState } from 'react';
declare const dreyv: any;

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export default function App() {
  const [amount, setAmount] = useState('1');
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function getQuote() {
    setLoading(true);
    try {
      const lamports = Math.floor(parseFloat(amount) * 1e9);
      const q = await dreyv.jupiter.quote({
        inputMint: SOL, outputMint: USDC,
        amount: String(lamports), slippageBps: '50',
      });
      setQuote(q);
    } finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-md mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Jupiter Quote</h1>
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 space-y-3">
        <label className="text-xs text-zinc-400">SOL amount</label>
        <input value={amount} onChange={e => setAmount(e.target.value)} type="number"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" />
        <button onClick={getQuote} disabled={loading}
          className="w-full bg-violet-600 hover:bg-violet-500 py-2 rounded-lg text-white font-medium disabled:opacity-50">
          {loading ? 'Quoting…' : 'Get quote'}
        </button>
      </div>
      {quote && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 text-sm space-y-2">
          <div className="flex justify-between"><span className="text-zinc-400">You pay</span><span className="text-white">{amount} SOL</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">You get</span><span className="text-emerald-400">{(Number(quote.outAmount) / 1e6).toFixed(2)} USDC</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Price impact</span><span className="text-white">{(Number(quote.priceImpactPct) * 100).toFixed(3)}%</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Route</span><span className="text-white">{quote.routePlan?.length || 0} hops</span></div>
        </div>
      )}
    </div>
  );
}`,
        },
    },

    {
        id: "birdeye-token-dashboard",
        name: "Birdeye Token Dashboard",
        description: "Live token price, market cap, and holder data from Birdeye",
        category: "Dreyv Gateway",
        icon: "\u{1F426}",
        files: {
            "App.tsx": `import { useState } from 'react';
declare const dreyv: any;

export default function App() {
  const [mint, setMint] = useState('So11111111111111111111111111111111111111112');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await dreyv.birdeye.tokenOverview({ address: mint });
      setData(res?.data || null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Token Dashboard</h1>
      <div className="flex gap-2">
        <input value={mint} onChange={e => setMint(e.target.value)}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white font-mono" />
        <button onClick={load} disabled={loading}
          className="bg-violet-600 hover:bg-violet-500 px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50">
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>
      {error && <div className="text-rose-400 text-sm">{error}</div>}
      {data && (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Symbol" value={data.symbol} />
          <Stat label="Price" value={'$' + Number(data.price || 0).toFixed(6)} />
          <Stat label="Market cap" value={'$' + Number(data.mc || 0).toLocaleString()} />
          <Stat label="24h volume" value={'$' + Number(data.v24hUSD || 0).toLocaleString()} />
          <Stat label="Holders" value={Number(data.holder || 0).toLocaleString()} />
          <Stat label="24h change" value={(Number(data.priceChange24hPercent || 0)).toFixed(2) + '%'} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-white mt-1">{value}</div>
    </div>
  );
}`,
        },
    },

    {
        id: "marinade-staking-monitor",
        name: "Marinade Staking Monitor",
        description: "Track mSOL APY for treasury staking decisions",
        category: "Dreyv Gateway",
        icon: "\u{1F30A}",
        files: {
            "App.tsx": `import { useEffect, useState } from 'react';
declare const dreyv: any;

export default function App() {
  const [apy, setApy] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dreyv.marinade.state({}).then((r: any) => { setApy(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-md mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">mSOL Staking</h1>
      {loading && <div className="text-zinc-500">Loading…</div>}
      {apy && (
        <div className="bg-gradient-to-br from-violet-500/10 to-emerald-500/10 border border-violet-500/20 rounded-xl p-6">
          <div className="text-xs text-violet-300 uppercase tracking-wider">30-day APY</div>
          <div className="text-5xl font-bold text-white mt-2">
            {(Number(apy.value || apy.apy || 0) * 100).toFixed(2)}%
          </div>
          <div className="text-xs text-zinc-400 mt-3">Marinade liquid staking · auto-compounding mSOL</div>
        </div>
      )}
    </div>
  );
}`,
        },
    },

    {
        id: "pyth-oracle-feed",
        name: "Pyth Oracle Feed",
        description: "Stream live SOL/BTC/ETH prices from Pyth on-chain oracles",
        category: "Dreyv Gateway",
        icon: "\u{1F52E}",
        files: {
            "App.tsx": `import { useEffect, useState } from 'react';
declare const dreyv: any;

const FEEDS = {
  'SOL/USD': 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'BTC/USD': 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'ETH/USD': 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
};

export default function App() {
  const [prices, setPrices] = useState<Record<string, any>>({});

  useEffect(() => {
    async function tick() {
      try {
        const res = await dreyv.pyth.latest({ ids: Object.values(FEEDS) });
        const next: Record<string, any> = {};
        const list = Array.isArray(res) ? res : (res?.parsed || []);
        for (const [name, id] of Object.entries(FEEDS)) {
          const m = list.find((p: any) => (p.id || '').endsWith(id) || p.id === id);
          if (m) next[name] = m;
        }
        setPrices(next);
      } catch {}
    }
    tick();
    const i = setInterval(tick, 5000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="p-6 max-w-md mx-auto space-y-3">
      <h1 className="text-2xl font-bold text-white">Pyth Oracle Feed</h1>
      <div className="space-y-2">
        {Object.keys(FEEDS).map(name => {
          const p = prices[name];
          const price = p ? Number(p.price?.price || 0) * Math.pow(10, Number(p.price?.expo || 0)) : null;
          return (
            <div key={name} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 flex justify-between items-center">
              <span className="text-white font-medium">{name}</span>
              <span className="text-emerald-400 font-mono text-lg">
                {price !== null ? '$' + price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '…'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}`,
        },
    },

    {
        id: "resend-email-blast",
        name: "Treasury Email Notifier",
        description: "Send transactional emails to your treasury team via Resend",
        category: "Dreyv Gateway",
        icon: "\u{2709}",
        files: {
            "App.tsx": `import { useState } from 'react';
declare const dreyv: any;

export default function App() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('Treasury alert');
  const [body, setBody] = useState('Vault balance threshold crossed.');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true); setStatus('');
    try {
      const res = await dreyv.resend.send({
        to: [to], subject, html: '<p>' + body + '</p>',
      });
      setStatus(res?.id ? 'Sent ✓ id=' + res.id : 'Sent');
    } catch (e: any) { setStatus('Error: ' + e.message); }
    finally { setSending(false); }
  }

  return (
    <div className="p-6 max-w-md mx-auto space-y-3">
      <h1 className="text-2xl font-bold text-white">Email Notifier</h1>
      <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@team.com"
        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white" />
      <input value={subject} onChange={e => setSubject(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white" />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white" />
      <button onClick={send} disabled={sending || !to}
        className="w-full bg-violet-600 hover:bg-violet-500 py-2 rounded-lg text-white font-medium disabled:opacity-50">
        {sending ? 'Sending…' : 'Send email'}
      </button>
      {status && <div className="text-sm text-zinc-300">{status}</div>}
    </div>
  );
}`,
        },
    },

    {
        id: "telegram-price-alert",
        name: "Telegram Price Alert Bot",
        description: "Push live price alerts to your team's Telegram channel",
        category: "Dreyv Gateway",
        icon: "\u{1F4E2}",
        files: {
            "App.tsx": `import { useState } from 'react';
declare const dreyv: any;

export default function App() {
  const [text, setText] = useState('🚀 SOL crossed $250 — review treasury exposure.');
  const [chatId, setChatId] = useState('');
  const [status, setStatus] = useState('');

  async function send() {
    setStatus('Sending…');
    try {
      const res = await dreyv.telegram.sendMessage({
        text, ...(chatId ? { chat_id: chatId } : {}),
      });
      setStatus(res?.ok ? '✓ Delivered' : 'Failed: ' + JSON.stringify(res));
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  return (
    <div className="p-6 max-w-md mx-auto space-y-3">
      <h1 className="text-2xl font-bold text-white">Telegram Alert</h1>
      <p className="text-xs text-zinc-500">Leave chat ID blank to use the default from your connection.</p>
      <input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="Chat ID (optional)"
        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white" />
      <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white" />
      <button onClick={send}
        className="w-full bg-violet-600 hover:bg-violet-500 py-2 rounded-lg text-white font-medium">
        Send to Telegram
      </button>
      {status && <div className="text-sm text-zinc-300">{status}</div>}
    </div>
  );
}`,
        },
    },

    {
        id: "slack-treasury-notifier",
        name: "Slack Treasury Notifier",
        description: "Post rich treasury updates to a Slack channel",
        category: "Dreyv Gateway",
        icon: "\u{1F4AC}",
        files: {
            "App.tsx": `import { useState } from 'react';
declare const dreyv: any;

export default function App() {
  const [channel, setChannel] = useState('');
  const [text, setText] = useState(':bank: Daily treasury summary');
  const [status, setStatus] = useState('');

  async function post() {
    setStatus('Posting…');
    try {
      const res = await dreyv.slack.postMessage({
        text,
        ...(channel ? { channel } : {}),
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Treasury Update' } },
          { type: 'section', text: { type: 'mrkdwn', text: text } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: 'Posted via Dreyv mini-app' }] },
        ],
      });
      setStatus(res?.ok ? '✓ Posted to ' + (res.channel || 'Slack') : 'Failed: ' + (res?.error || 'unknown'));
    } catch (e: any) { setStatus('Error: ' + e.message); }
  }

  return (
    <div className="p-6 max-w-md mx-auto space-y-3">
      <h1 className="text-2xl font-bold text-white">Slack Notifier</h1>
      <input value={channel} onChange={e => setChannel(e.target.value)} placeholder="#treasury (optional)"
        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white" />
      <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white" />
      <button onClick={post}
        className="w-full bg-violet-600 hover:bg-violet-500 py-2 rounded-lg text-white font-medium">
        Post to Slack
      </button>
      {status && <div className="text-sm text-zinc-300">{status}</div>}
    </div>
  );
}`,
        },
    },
];
