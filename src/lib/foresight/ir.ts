/**
 * Dashboard IR (Intermediate Representation)
 * ──────────────────────────────────────────
 * Every Foresight / What-If response — whether produced by the NL parser,
 * the LLM agent, or a server-side simulator — must conform to this schema.
 *
 * The deterministic renderer (`<DashboardIRRenderer />`) paints the IR
 * using on-brand primitives (Manrope, violet, ambient glows). This replaces
 * the iframe + Babel + arbitrary TSX path entirely.
 *
 * Why an IR:
 *   • Brand-consistent (no rogue dark surfaces, no fuchsia gradients)
 *   • Deterministic (same input → same UI, screenshot-stable)
 *   • Token-efficient (LLM emits ~1KB JSON instead of ~5KB JSX)
 *   • Auditable (we can hash + persist scenarios; FP&A governance)
 *   • Bound to truth (visuals reference real series by binding id, never inline mocks)
 */

import { z } from "zod";

// ─── Scenario ───────────────────────────────────────────────────────

export const ScenarioDriverSchema = z.object({
  /** Stable id for diffing / grouping (e.g. "sol_price_shock") */
  id: z.string(),
  /** Human label ("SOL price") */
  label: z.string(),
  /** Plain-language change ("drops 40%", "stays flat") */
  change: z.string(),
  /** Numeric magnitude when present (negative = down) */
  magnitude: z.number().nullable().optional(),
  unit: z.enum(["percent", "usd", "tokens", "months", "ratio"]).optional(),
});
export type ScenarioDriver = z.infer<typeof ScenarioDriverSchema>;

export const ScenarioSchema = z.object({
  /** Short title shown in scenario header ("SOL -40% over 12 months") */
  title: z.string(),
  /** One-sentence description of what was asked */
  description: z.string().optional(),
  /** Drivers that distinguish this scenario from baseline */
  drivers: z.array(ScenarioDriverSchema),
  /** Projection horizon */
  timeframeMonths: z.number().int().positive(),
  /** Parser/agent confidence 0-1 */
  confidence: z.number().min(0).max(1).optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

// ─── Metric (KPI) ───────────────────────────────────────────────────

export const MetricSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Current/baseline numeric value */
  value: z.number(),
  /** Simulated value (when scenario != baseline) */
  simulated: z.number().optional(),
  /** Pre-computed delta (simulated - value); renderer can also derive */
  delta: z.number().optional(),
  format: z.enum(["currency", "percent", "number", "months", "ratio"]),
  /** Decimals for the display value */
  decimals: z.number().int().min(0).max(4).optional(),
  /** Optional sub-label ("vs baseline", "p50 outcome", "as of 2d ago") */
  hint: z.string().optional(),
  /** Tone hint; renderer falls back to delta sign */
  tone: z.enum(["neutral", "positive", "negative", "warning"]).optional(),
});
export type Metric = z.infer<typeof MetricSchema>;

// ─── Visual bindings ────────────────────────────────────────────────

/**
 * Visuals never inline data — they reference a binding id that the host
 * page resolves to a real series (snapshots, simulation projection, events…).
 *
 * If a visual carries inline `data`, it must be marked `source: "inline"`
 * so reviewers know it isn't bound to live truth.
 */
export const SeriesPointSchema = z.object({
  x: z.union([z.string(), z.number()]),
  y: z.number(),
  /** Optional band (P10/P90 etc.) for fan charts */
  yLow: z.number().optional(),
  yHigh: z.number().optional(),
});

export const VisualBindingSchema = z.object({
  /** Where the renderer fetches the series from */
  source: z.enum(["snapshots", "projection", "events", "composition", "inline"]),
  /** Stable id when source !== "inline" */
  bindingId: z.string().optional(),
  /** Inline data when source === "inline" */
  data: z.array(SeriesPointSchema).optional(),
});
export type VisualBinding = z.infer<typeof VisualBindingSchema>;

export const VisualSchema = z.object({
  id: z.string(),
  type: z.enum([
    "kpi_strip",
    "time_series",
    "fan_chart",
    "waterfall",
    "donut",
    "bar",
    "table",
    "callout",
  ]),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  /** Series for the renderer; some types accept multiple (baseline + simulated) */
  series: z.array(z.object({
    id: z.string(),
    label: z.string(),
    binding: VisualBindingSchema,
    color: z.enum(["violet", "emerald", "rose", "slate", "amber"]).optional(),
    /** Render the series as a dashed/ghost overlay (used for baselines under sim) */
    ghost: z.boolean().optional(),
  })).optional(),
  /** For kpi_strip / table */
  metrics: z.array(MetricSchema).optional(),
  /** For callout */
  body: z.string().optional(),
  callout: z.enum(["info", "warning", "risk", "success"]).optional(),
});
export type Visual = z.infer<typeof VisualSchema>;

// ─── Rationale + Trust ──────────────────────────────────────────────

export const TrustChipSchema = z.object({
  label: z.string(),
  /** "as of 2 hours ago" / "snapshots: 18" / "monte carlo: 200 paths" */
  value: z.string(),
  tone: z.enum(["neutral", "warning"]).optional(),
});
export type TrustChip = z.infer<typeof TrustChipSchema>;

export const RationaleSchema = z.object({
  /** 1-3 sentence explanation in plain language */
  summary: z.string(),
  /** Bullet "what moved the number" — links to drivers/metrics by id */
  drivers: z.array(z.object({
    refId: z.string().optional(),
    text: z.string(),
  })).optional(),
  /** Risk flags / model limits / disclaimers */
  caveats: z.array(z.string()).optional(),
  /** Trust signals (data freshness, scope, sample size) */
  trust: z.array(TrustChipSchema).optional(),
});
export type Rationale = z.infer<typeof RationaleSchema>;

// ─── Top-level IR ───────────────────────────────────────────────────

export const DashboardIRSchema = z.object({
  version: z.literal(1),
  scenario: ScenarioSchema,
  /** Hero metrics rendered above the visuals (the "answer first") */
  headline: z.array(MetricSchema).min(1).max(4),
  visuals: z.array(VisualSchema),
  rationale: RationaleSchema,
  /** Stable hash for audit trail / persistence */
  hash: z.string().optional(),
});
export type DashboardIR = z.infer<typeof DashboardIRSchema>;

/** Cheap, deterministic hash for IR audit ids */
export function hashIR(ir: DashboardIR): string {
  const canon = JSON.stringify({
    s: ir.scenario,
    h: ir.headline.map((m) => [m.id, m.value, m.simulated]),
    v: ir.visuals.map((v) => [v.id, v.type]),
  });
  let h = 5381;
  for (let i = 0; i < canon.length; i++) h = ((h << 5) + h + canon.charCodeAt(i)) >>> 0;
  return `ir_${h.toString(36)}`;
}
