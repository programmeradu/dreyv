/**
 * Normalize raw Webacy responses into `RiskScore`.
 *
 * Webacy returns many shapes across endpoints; we defensively unwrap
 * the fields we care about (risk score, flags, tags, categories) and
 * bucket the numeric score into a fixed 5-level scale used everywhere
 * in the app.
 */

import { RiskLevel, RiskScore, UNKNOWN_RISK } from "./types";

/**
 * Buckets align with Webacy's own dashboard vocabulary:
 *   0     → safest
 *   1–29  → safe
 *   30–69 → medium
 *   70+   → high
 */
export function bucketNumeric(n: number | null | undefined): RiskLevel {
  if (n === null || n === undefined || Number.isNaN(n)) return "unknown";
  if (n <= 0) return "safest";
  if (n < 30) return "safe";
  if (n < 70) return "medium";
  return "high";
}

type Loose = Record<string, unknown>;

function pickNumber(obj: Loose, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function pickStringArray(obj: Loose, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      return v
        .map((x) => {
          if (typeof x === "string") return x;
          if (x && typeof x === "object") {
            const r = x as Loose;
            return (r.name || r.tag || r.category || r.type || r.title || "") as string;
          }
          return "";
        })
        .filter(Boolean)
        .slice(0, 8);
    }
  }
  return [];
}

/** Normalize any Webacy address/token/tx-shaped payload. */
export function normalizeRiskPayload(subject: string, raw: unknown): RiskScore {
  if (!raw || typeof raw !== "object") return UNKNOWN_RISK(subject);
  const obj = raw as Loose;

  // Common Webacy fields across quick-profile / addresses / transactions:
  //   overallRisk / medium / high / count / riskScore / score
  //   issues[] / risks[] / tags[] / flags[]
  const numeric =
    pickNumber(obj, "overallRisk", "riskScore", "score", "risk_level", "risk") ??
    pickNumber((obj.risk as Loose) ?? {}, "score", "overallRisk");

  const flags = [
    ...pickStringArray(obj, "issues", "risks", "flags", "tags", "categories", "labels"),
    ...pickStringArray((obj.risk as Loose) ?? {}, "issues", "risks", "flags"),
  ];

  // Prefer explicit provider-supplied bucket if present, otherwise infer.
  const explicitLevel = typeof obj.level === "string" ? (obj.level as string).toLowerCase() : "";
  const level: RiskLevel =
    explicitLevel === "high" || explicitLevel === "medium" || explicitLevel === "safe" || explicitLevel === "safest"
      ? (explicitLevel as RiskLevel)
      : bucketNumeric(numeric);

  return {
    level,
    numeric,
    flags: Array.from(new Set(flags)).slice(0, 8),
    subject,
    source: "webacy",
  };
}
