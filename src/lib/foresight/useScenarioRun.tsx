"use client";

/**
 * useScenarioRun
 * ──────────────
 * When a CommandBar prompt parses into simulation variables it calls
 * `useSimulationStore.startSimulation(...)`. That just flips `active=true`,
 * `loading=true` and stores the variables — somebody still has to actually
 * call `/api/simulation` and feed the result back in.
 *
 * This hook is mounted once on the analytics page. It watches the store,
 * builds a portfolio snapshot from the live vault, fires the simulation,
 * and writes the result back via `setResult` / `setError`. After that the
 * scenario overlay (banner, ghost series, deltas) lights up automatically
 * everywhere else on the page.
 */

import { useEffect, useRef } from "react";
import { useSimulationStore } from "@/lib/stores/simulation-store";
import { useVault } from "@/lib/contexts/VaultContext";

const STABLE = new Set([
  "USDC", "USDT", "DAI", "BUSD", "TUSD", "USDP", "FRAX", "PYUSD", "EURC",
]);

export function useScenarioRun() {
  const { vaultTokens, vaultValue } = useVault();
  const active = useSimulationStore((s) => s.active);
  const loading = useSimulationStore((s) => s.loading);
  const result = useSimulationStore((s) => s.result);
  const variables = useSimulationStore((s) => s.variables);
  const timeframeMonths = useSimulationStore((s) => s.timeframeMonths);
  const setResult = useSimulationStore((s) => s.setResult);
  const setError = useSimulationStore((s) => s.setError);

  // Avoid re-running for the same variable signature
  const lastKey = useRef<string>("");

  useEffect(() => {
    if (!active) return;
    if (result) return;
    if (!loading) return;

    const tokens = vaultTokens ?? [];
    if (!tokens.length) {
      setError("Connect a wallet to run this simulation against your treasury.");
      return;
    }

    const portfolio = tokens
      .map((t: any) => ({
        symbol: (t.symbol ?? "SPL").toUpperCase(),
        amount: Number(t.amount ?? 0),
        price: Number(t.price ?? 0),
        change24h: Number(t.change24h ?? 0),
        isStable: STABLE.has(String(t.symbol ?? "").toUpperCase()),
        mint: t.mint,
      }))
      .filter((t) => t.amount > 0);

    if (!portfolio.length) {
      setError("Your vault is empty — nothing to simulate against.");
      return;
    }

    const key = JSON.stringify({ variables, timeframeMonths, n: portfolio.length });
    if (key === lastKey.current) return;
    lastKey.current = key;

    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/simulation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            portfolio,
            variables,
            timeframeMonths,
            granularity: "monthly",
            priceSource: "vault",
          }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || `Simulation failed (${res.status})`);
        }
        const json = await res.json();
        setResult({
          projection: json.projection ?? [],
          summary: {
            ...json.summary,
            currentValue: json.summary?.currentValue ?? vaultValue ?? 0,
          },
          metadata: {
            variables,
            timeframeMonths,
            computedAt: Date.now(),
          },
        });
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Simulation failed");
      }
    })();

    return () => ctrl.abort();
  }, [active, loading, result, variables, timeframeMonths, vaultTokens, vaultValue, setResult, setError]);
}
