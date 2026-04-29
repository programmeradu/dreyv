/**
 * irFromSimulation
 * ────────────────
 * Adapter that turns a `/api/simulation` response (+ context) into a
 * fully-formed `DashboardIR`. This is the deterministic foundation —
 * an LLM may *enrich* the rationale, but it cannot invent visuals or
 * unbind metrics from the underlying numbers.
 */

import {
  type DashboardIR,
  type Visual,
  type Metric,
  type Scenario,
  type ScenarioDriver,
  type Rationale,
  hashIR,
} from "./ir";
import type {
  SimulationVariable,
  SimulationResult,
} from "@/lib/stores/simulation-store";

interface BuildArgs {
  prompt: string;
  variables: SimulationVariable[];
  result: SimulationResult;
  /** Real treasury value series (snapshots) for the baseline overlay */
  baseline?: { date: string; value: number }[];
  /** Optional confidence (parser confidence, 0-1) */
  confidence?: number;
  /** Optional title override */
  title?: string;
}

function deriveTitle(variables: SimulationVariable[]): string {
  if (!variables.length) return "Baseline outlook";
  const parts = variables.slice(0, 3).map((v) => {
    switch (v.type) {
      case "price_change":
        return `${v.asset ?? "Market"} ${v.value > 0 ? "+" : ""}${Math.round(v.value * 100)}%`;
      case "burn_rate":
        return `Burn $${Math.round(v.value / 1000)}k/mo`;
      case "inflow":
        return `Inflow $${Math.round(v.value / 1000)}k/mo`;
      case "yield_apy":
        return `${(v.value * 100).toFixed(1)}% yield`;
      case "custom":
        return v.label;
      default:
        return v.label;
    }
  });
  return parts.join(" · ");
}

function variablesToDrivers(vars: SimulationVariable[]): ScenarioDriver[] {
  return vars.map((v) => {
    let change = "";
    let unit: ScenarioDriver["unit"] = "ratio";
    let magnitude: number | null = null;
    switch (v.type) {
      case "price_change":
        magnitude = v.value;
        unit = "percent";
        change = v.value === 0
          ? "stays flat"
          : `${v.value > 0 ? "rises" : "drops"} ${Math.abs(Math.round(v.value * 100))}%`;
        break;
      case "burn_rate":
        magnitude = v.value;
        unit = "usd";
        change = `runs at $${Math.round(v.value).toLocaleString()}/mo`;
        break;
      case "inflow":
        magnitude = v.value;
        unit = "usd";
        change = `adds $${Math.round(v.value).toLocaleString()}/mo`;
        break;
      case "yield_apy":
        magnitude = v.value;
        unit = "percent";
        change = `compounds at ${(v.value * 100).toFixed(2)}% APY`;
        break;
      case "custom":
        magnitude = v.value;
        unit = (v.unit as any) ?? "ratio";
        change = `set to ${v.value}`;
        break;
      default:
        change = v.label;
    }
    return {
      id: v.id,
      label: v.label,
      change,
      magnitude,
      unit,
    };
  });
}

export function irFromSimulation(args: BuildArgs): DashboardIR {
  const { prompt, variables, result, baseline = [], confidence = 0.7, title } = args;
  const s = result.summary;

  const scenario: Scenario = {
    title: title ?? deriveTitle(variables),
    description: prompt,
    drivers: variablesToDrivers(variables),
    timeframeMonths: result.metadata.timeframeMonths,
    confidence,
  };

  // ── Headline metrics: "answer first" ─────────────────────────────
  const headline: Metric[] = [
    {
      id: "projected_value",
      label: `Projected value (${result.metadata.timeframeMonths}mo)`,
      value: s.currentValue,
      simulated: s.projectedEndValue,
      delta: s.delta,
      format: "currency",
      decimals: 0,
      hint: `${s.deltaPercent.toFixed(1)}% vs today`,
      tone: s.deltaPercent >= 0 ? "positive" : s.deltaPercent < -25 ? "negative" : "warning",
    },
    {
      id: "delta_pct",
      label: "Delta vs baseline",
      value: 0,
      simulated: s.deltaPercent,
      delta: s.deltaPercent,
      format: "percent",
      decimals: 1,
      tone: s.deltaPercent >= 0 ? "positive" : "negative",
    },
  ];

  if (s.runwayMonths != null) {
    headline.push({
      id: "runway",
      label: "Runway under this scenario",
      value: s.runwayMonths,
      simulated: s.runwayMonths,
      format: "months",
      decimals: 1,
      tone: s.runwayMonths < 6 ? "negative" : s.runwayMonths < 12 ? "warning" : "neutral",
      hint: s.depletionDate ? `Depletes ${s.depletionDate}` : undefined,
    });
  }

  if (s.riskFlags?.length) {
    headline.push({
      id: "risk_count",
      label: "Risk flags",
      value: 0,
      simulated: s.riskFlags.length,
      delta: s.riskFlags.length,
      format: "number",
      decimals: 0,
      tone: s.riskFlags.length >= 3 ? "negative" : "warning",
    });
  }

  // ── Visuals: headline strip + value trajectory + risk callouts ───
  const visuals: Visual[] = [
    {
      id: "kpi_strip",
      type: "kpi_strip",
      metrics: headline,
    },
    {
      id: "value_trajectory",
      type: "time_series",
      title: "Value trajectory",
      subtitle: "Baseline (solid) vs simulated (dashed) over the horizon",
      series: [
        ...(baseline.length >= 2
          ? [{
              id: "baseline",
              label: "Baseline",
              binding: {
                source: "inline" as const,
                data: baseline.map((b) => ({ x: b.date, y: b.value })),
              },
              color: "violet" as const,
              ghost: false,
            }]
          : []),
        {
          id: "simulated",
          label: "Simulated",
          binding: {
            source: "inline" as const,
            data: result.projection.map((p) => ({ x: p.date, y: p.totalValue })),
          },
          color: "violet" as const,
          ghost: true,
        },
      ],
    },
  ];

  if (s.riskFlags?.length) {
    visuals.push({
      id: "risk_callout",
      type: "callout",
      title: "Risk flags raised by this scenario",
      callout: s.riskFlags.length >= 3 ? "risk" : "warning",
      body: s.riskFlags.map((f) => `• ${f.replace(/_/g, " ").toLowerCase()}`).join("\n"),
    });
  }

  // ── Rationale + trust ────────────────────────────────────────────
  const rationale: Rationale = {
    summary: buildRationaleSummary(scenario, s),
    drivers: scenario.drivers.map((d) => ({
      refId: d.id,
      text: `${d.label} ${d.change}.`,
    })),
    caveats: [
      "Projections assume the scenario drivers hold for the full horizon.",
      "Volatility seeded from the last 24h — real markets can deviate sharply.",
      ...(s.riskFlags?.includes("UNREALISTIC_YIELD_ASSUMPTION")
        ? ["Yield assumption exceeds 50% APY — treat as upper bound only."]
        : []),
    ],
    trust: [
      { label: "Horizon", value: `${result.metadata.timeframeMonths} months` },
      { label: "Drivers", value: `${variables.length}` },
      { label: "Path points", value: `${result.projection.length}` },
      { label: "Confidence", value: `${Math.round(confidence * 100)}%`, tone: confidence < 0.4 ? "warning" : "neutral" },
    ],
  };

  const ir: DashboardIR = {
    version: 1,
    scenario,
    headline,
    visuals,
    rationale,
  };
  ir.hash = hashIR(ir);
  return ir;
}

function buildRationaleSummary(
  scenario: Scenario,
  s: SimulationResult["summary"],
): string {
  const dir = s.deltaPercent >= 0 ? "grows" : "shrinks";
  const pct = Math.abs(s.deltaPercent).toFixed(1);
  const runway = s.runwayMonths != null ? ` Runway lands at ~${s.runwayMonths} months.` : "";
  const risks = s.riskFlags?.length
    ? ` ${s.riskFlags.length} risk flag${s.riskFlags.length > 1 ? "s" : ""} were raised.`
    : "";
  return `Under "${scenario.title}", treasury ${dir} ${pct}% over ${scenario.timeframeMonths} months.${runway}${risks}`;
}
