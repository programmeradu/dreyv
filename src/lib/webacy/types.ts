/**
 * Normalized risk types shared across the Webacy integration.
 *
 * We never leak raw Webacy JSON past `src/lib/webacy/`. All UI + policy
 * code consumes these normalized shapes so we can swap providers or
 * upgrade endpoints without a cross-cutting refactor.
 */

export type RiskLevel = "safest" | "safe" | "medium" | "high" | "unknown";

export interface RiskScore {
  level: RiskLevel;
  /** 0–100 (higher = riskier). `null` when the provider gave us nothing usable. */
  numeric: number | null;
  /** Human-readable flag reasons (e.g. "honeypot pattern", "sanctioned"). */
  flags: string[];
  /** The address / mint / url this score applies to. */
  subject: string;
  /** Source provider — always "webacy" today, kept for future providers. */
  source: "webacy" | "unknown";
}

export const UNKNOWN_RISK = (subject: string): RiskScore => ({
  level: "unknown",
  numeric: null,
  flags: [],
  subject,
  source: "unknown",
});

const ORDER: RiskLevel[] = ["safest", "safe", "medium", "high", "unknown"];

/** Compare two risk levels, "unknown" treated as lowest confidence, not highest risk. */
export function worstRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank = (l: RiskLevel) => (l === "unknown" ? -1 : ORDER.indexOf(l));
  return rank(a) >= rank(b) ? a : b;
}

export function isBlockingRisk(level: RiskLevel): boolean {
  return level === "high";
}

export function isWarningRisk(level: RiskLevel): boolean {
  return level === "medium" || level === "high";
}
