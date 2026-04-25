/**
 * Jito MEV opportunity poller.
 *
 * Polls Jito's public bundle / tip-stream APIs for unusual MEV activity that
 * could affect Dreyv-managed treasuries (sandwich risk windows, large
 * priority-fee spikes, validator concentration changes). Surfaces high-signal
 * findings as `agent.opportunity.surfaced` for the brain router.
 *
 * Designed to be invoked from an Inngest cron (e.g. every 2 minutes) — see
 * `src/lib/agents/brains/functions.ts`. Degrades to no-op if the Jito API is
 * unreachable or returns no notable activity.
 */
import { publish } from "@/lib/agents/bus";

const JITO_TIPS_URL = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";
const HIGH_TIP_LAMPORTS = 1_000_000; // 0.001 SOL — unusual priority fee floor

export interface JitoTipSnapshot {
  observedAt: string;
  landed_tips_25th_percentile?: number;
  landed_tips_50th_percentile?: number;
  landed_tips_75th_percentile?: number;
  landed_tips_95th_percentile?: number;
  landed_tips_99th_percentile?: number;
  ema_landed_tips_50th_percentile?: number;
}

export async function fetchJitoTipFloor(): Promise<JitoTipSnapshot | null> {
  try {
    const res = await fetch(JITO_TIPS_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") return null;
    return { observedAt: new Date().toISOString(), ...row };
  } catch (e: any) {
    console.warn("[jito-poller] tip-floor fetch failed:", e?.message);
    return null;
  }
}

/**
 * Poll once and surface an opportunity if MEV activity looks unusual.
 * Returns true when something was surfaced.
 */
export async function pollJitoOnce(): Promise<boolean> {
  const snap = await fetchJitoTipFloor();
  if (!snap) return false;

  const p95 = snap.landed_tips_95th_percentile ?? 0;
  const p99 = snap.landed_tips_99th_percentile ?? 0;
  const ema50 = snap.ema_landed_tips_50th_percentile ?? 0;

  if (p99 < HIGH_TIP_LAMPORTS && ema50 < HIGH_TIP_LAMPORTS / 4) {
    return false; // calm market
  }

  try {
    await publish({
      name: "agent.opportunity.surfaced",
      data: {
        reason:
          p99 >= HIGH_TIP_LAMPORTS * 5
            ? "jito_mev_storm_p99_extreme"
            : "jito_mev_elevated_priority_fees",
        observedAt: snap.observedAt,
        chain: "solana",
        type: "mev",
        amountUsd: undefined,
        raw: snap,
        movers: [],
        pools: [],
      },
    });
    return true;
  } catch (e: any) {
    console.warn("[jito-poller] surface failed:", e?.message);
    return false;
  }
}
