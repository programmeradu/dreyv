/**
 * POST /api/foresight/ir
 * ──────────────────────
 * Single endpoint that returns a fully-formed Dashboard IR for a what-if
 * scenario. Replaces the iframe + Babel codegen path entirely.
 *
 * Body: {
 *   prompt: string;
 *   variables: SimulationVariable[];
 *   timeframeMonths?: number;
 *   portfolio: PortfolioToken[];
 *   baseline?: { date: string; value: number }[];
 *   confidence?: number;
 * }
 *
 * Response: DashboardIR (see src/lib/foresight/ir.ts)
 *
 * Determinism: same inputs → identical IR (the renderer is pure, the
 * simulator is seeded). The `hash` field doubles as an audit id.
 */

import { NextRequest, NextResponse } from "next/server";
import { irFromSimulation } from "@/lib/foresight/ir-adapter";
import { DashboardIRSchema } from "@/lib/foresight/ir";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt = "",
      variables = [],
      timeframeMonths = 12,
      portfolio = [],
      baseline = [],
      confidence = 0.7,
      title,
    } = body ?? {};

    if (!Array.isArray(portfolio) || portfolio.length === 0) {
      return NextResponse.json(
        { error: "portfolio is required and must be non-empty" },
        { status: 400 },
      );
    }
    if (!Array.isArray(variables)) {
      return NextResponse.json(
        { error: "variables must be an array" },
        { status: 400 },
      );
    }

    // ── Run the deterministic simulation ──────────────────────────
    const origin = req.nextUrl.origin;
    const simRes = await fetch(`${origin}/api/simulation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolio,
        variables,
        timeframeMonths,
        granularity: "monthly",
        priceSource: "vault",
      }),
    });
    if (!simRes.ok) {
      const e = await simRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: e.error || `simulation failed (${simRes.status})` },
        { status: 502 },
      );
    }
    const sim = await simRes.json();

    // ── Adapt simulation → IR ─────────────────────────────────────
    const ir = irFromSimulation({
      prompt,
      variables,
      result: {
        projection: sim.projection ?? [],
        summary: sim.summary,
        metadata: {
          variables,
          timeframeMonths,
          computedAt: Date.now(),
        },
      },
      baseline,
      confidence,
      title,
    });

    // ── Validate against the IR schema (defense in depth) ─────────
    const parsed = DashboardIRSchema.safeParse(ir);
    if (!parsed.success) {
      console.error("[/api/foresight/ir] IR failed validation", parsed.error.flatten());
      return NextResponse.json(
        { error: "internal: produced IR did not validate", details: parsed.error.flatten() },
        { status: 500 },
      );
    }

    return NextResponse.json(parsed.data);
  } catch (err: any) {
    console.error("[/api/foresight/ir] error", err);
    return NextResponse.json(
      { error: err?.message || "ir build failed" },
      { status: 500 },
    );
  }
}
