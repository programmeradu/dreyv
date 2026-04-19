"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, TrendingUp, AlertCircle } from "lucide-react";
import { toast } from "@/lib/toast-notifications";
import { formatCurrency } from "@/lib/atlas-utils";

type StrategyType = "stake" | "swap" | "lp";

interface CalculationResult {
  strategy: StrategyType;
  amountSol: number;
  daysAgo: number;
  historicalPrice: number;
  currentPrice: number;
  returns: number;
  hodlReturns: number;
  performanceVsHodl: number;
  strategyReturn: number;
}

export function TransactionTimeMachine() {
  const [strategy, setStrategy] = useState<StrategyType>("stake");
  const [amountSol, setAmountSol] = useState<string>("10");
  const [daysAgo, setDaysAgo] = useState<string>("30");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalculationResult | null>(null);

  const handleCalculate = async () => {
    const amount = parseFloat(amountSol);
    const days = parseInt(daysAgo);

    // Validation
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid SOL amount");
      return;
    }
    if (isNaN(days) || days < 1 || days > 365) {
      setError("Days must be between 1 and 365");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Fetch current SOL price
      const priceResponse = await fetch("/api/jupiter/price?ids=SOL");
      const priceData = await priceResponse.json();

      if (!priceResponse.ok || !priceData?.data?.SOL?.price) {
        throw new Error("Failed to fetch current SOL price");
      }

      const currentPrice = priceData.data.SOL.price;

      // Fetch REAL historical price
      const historicalResponse = await fetch(
        `/api/jupiter/historical-price?symbol=SOL&mint=So11111111111111111111111111111111111111112&daysAgo=${days}`
      );
      const historicalData = await historicalResponse.json();

      if (!historicalResponse.ok || !historicalData?.historicalPrice) {
        throw new Error(historicalData?.error || "Failed to fetch historical price");
      }

      const historicalPrice = historicalData.historicalPrice;
      const priceSource = historicalData.source || "unknown";

      // Calculate HODL returns
      const hodlReturns = amount * currentPrice - amount * historicalPrice;
      const hodlReturnPct = ((currentPrice - historicalPrice) / historicalPrice) * 100;

      // Calculate strategy returns
      let strategyReturn = 0;
      let totalValue = 0;

      switch (strategy) {
        case "stake":
          // 7% APY staking
          const stakingAPY = 0.07;
          const yearFraction = days / 365;
          strategyReturn = amount * stakingAPY * yearFraction;
          totalValue = amount * currentPrice + strategyReturn * currentPrice;
          break;

        case "swap":
          // Direct price comparison (swapped at historical price to USDC, back to SOL)
          const usdcValue = amount * historicalPrice;
          const solBought = usdcValue / currentPrice;
          strategyReturn = (solBought - amount) * currentPrice;
          totalValue = solBought * currentPrice;
          break;

        case "lp":
          // 20% APR for LP
          const lpAPR = 0.20;
          const lpYearFraction = days / 365;
          const lpYield = amount * lpAPR * lpYearFraction;
          // Impermanent loss: IL = 2*sqrt(r)/(1+r) - 1, where r = currentPrice/historicalPrice
          const priceRatio = currentPrice / historicalPrice;
          const ilFactor = 2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1;
          const ilLoss = Math.abs(ilFactor) * amount * currentPrice;
          strategyReturn = lpYield - ilLoss;
          totalValue = amount * currentPrice + strategyReturn;
          break;
      }

      const performanceVsHodl = strategyReturn - hodlReturns;

      setResult({
        strategy,
        amountSol: amount,
        daysAgo: days,
        historicalPrice,
        currentPrice,
        returns: strategyReturn,
        hodlReturns,
        performanceVsHodl,
        strategyReturn,
      });

      const sourceMsg = priceSource === "approximation"
        ? "Using approximated historical data"
        : `Real historical data from ${priceSource}`;

      toast.success("Calculation complete", {
        description: sourceMsg,
      });
    } catch (e: any) {
      setError(e?.message || "Failed to calculate returns");
      toast.error("Calculation failed", {
        description: e?.message || "An error occurred",
      });
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="space-y-3">
      {/* Strategy Selection */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Strategy</div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 gap-0.5">
          {(["stake", "swap", "lp"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStrategy(s)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                strategy === s
                  ? "bg-violet-600 text-white font-medium shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {s === "stake" ? "Stake 7%" : s === "swap" ? "Swap" : "LP 20%"}
            </button>
          ))}
        </div>
      </div>

      {/* Input Fields */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">Amount (SOL)</label>
          <Input type="number" min="0" step="0.1" value={amountSol} onChange={(e) => setAmountSol(e.target.value)} placeholder="10" className="h-9 text-sm bg-white border-slate-200" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">Days Ago (1-365)</label>
          <Input type="number" min="1" max="365" value={daysAgo} onChange={(e) => setDaysAgo(e.target.value)} placeholder="30" className="h-9 text-sm bg-white border-slate-200" />
        </div>
      </div>

      {/* Calculate Button — Atlas violet */}
      <button
        onClick={handleCalculate}
        disabled={loading}
        className="w-full py-2.5 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Calculating…
          </>
        ) : (
          <>
            <TrendingUp className="h-4 w-4" />
            Calculate Returns
          </>
        )}
      </button>

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
          )}

          {/* Results Display */}
          {loading && (
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}

          {result && !loading && (
            <div className="space-y-2 text-xs">
              {/* Price comparison row */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md p-2 bg-card/60">
                  <div className="text-[10px] opacity-60">{result.daysAgo}d ago</div>
                  <div className="font-mono font-medium">{formatCurrency(result.historicalPrice)}</div>
                </div>
                <div className="rounded-md p-2 bg-card/60">
                  <div className="text-[10px] opacity-60">Now</div>
                  <div className="font-mono font-medium">{formatCurrency(result.currentPrice)}</div>
                </div>
              </div>

              {/* Returns */}
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="opacity-60">Strategy Returns</span>
                  <span className={`font-mono font-medium ${result.returns >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {formatCurrency(result.returns)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60">HODL Returns</span>
                  <span className={`font-mono font-medium ${result.hodlReturns >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {formatCurrency(result.hodlReturns)}
                  </span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between">
                  <span className="font-medium">vs HODL</span>
                  <span className={`font-mono font-bold ${result.performanceVsHodl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {result.performanceVsHodl >= 0 ? '+' : ''}{formatCurrency(result.performanceVsHodl)}
                  </span>
                </div>
              </div>

              <div className="text-[10px] opacity-50 italic">Prices from CoinGecko/Birdeye</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
