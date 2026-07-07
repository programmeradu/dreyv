import { describe, it, expect } from "vitest";
import { bucketNumeric, normalizeRiskPayload } from "./normalize";
import { worstRisk } from "./types";

describe("bucketNumeric", () => {
  it("buckets across the spectrum", () => {
    expect(bucketNumeric(0)).toBe("safest");
    expect(bucketNumeric(15)).toBe("safe");
    expect(bucketNumeric(45)).toBe("medium");
    expect(bucketNumeric(85)).toBe("high");
    expect(bucketNumeric(null)).toBe("unknown");
    expect(bucketNumeric(undefined)).toBe("unknown");
  });
});

describe("normalizeRiskPayload", () => {
  it("returns unknown for empty payloads", () => {
    expect(normalizeRiskPayload("addr", null).level).toBe("unknown");
    expect(normalizeRiskPayload("addr", {}).level).toBe("unknown");
  });

  it("infers level from overallRisk score", () => {
    const r = normalizeRiskPayload("addr", { overallRisk: 82, issues: ["honeypot", "deployer_rugged"] });
    expect(r.level).toBe("high");
    expect(r.flags).toContain("honeypot");
    expect(r.numeric).toBe(82);
    expect(r.source).toBe("webacy");
  });

  it("prefers explicit level when provided", () => {
    const r = normalizeRiskPayload("addr", { level: "medium", overallRisk: 5 });
    expect(r.level).toBe("medium");
  });

  it("extracts nested string arrays from object flags", () => {
    const r = normalizeRiskPayload("addr", {
      overallRisk: 40,
      tags: [{ name: "phishing_domain" }, { category: "high_gas" }],
    });
    expect(r.flags).toEqual(expect.arrayContaining(["phishing_domain", "high_gas"]));
    expect(r.level).toBe("medium");
  });
});

describe("worstRisk", () => {
  it("high beats medium beats safe beats safest", () => {
    expect(worstRisk("safe", "high")).toBe("high");
    expect(worstRisk("medium", "safe")).toBe("medium");
    expect(worstRisk("safest", "safe")).toBe("safe");
  });
  it("unknown never wins over a real level", () => {
    expect(worstRisk("unknown", "safe")).toBe("safe");
    expect(worstRisk("high", "unknown")).toBe("high");
  });
});
