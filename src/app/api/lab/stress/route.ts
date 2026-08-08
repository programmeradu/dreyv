export const runtime = "edge";
import { NextResponse } from "next/server";
import { resolveAddressPositions } from "@/lib/lab/positions";
import { runStress } from "@/lib/lab/engine";
import type { LabScenario, LabScenarioKind } from "@/lib/lab/types";

export const dynamic = "force-dynamic";

const PRESETS: Record<string, LabScenario> = {
  sol_crash: { kind: "sol_crash", label: "SOL −40% in 24h", params: { movePct: -40, windowHours: 24 } },
  sol_crash_deep: { kind: "sol_crash", label: "SOL −60% in 48h", params: { movePct: -60, windowHours: 48 } },
  usdc_depeg: { kind: "usdc_depeg", label: "USDC depeg −8%", params: { depegPct: -8 } },
  lst_slashing: { kind: "lst_slashing", label: "LST slashing −5%", params: { slashingPct: -5 } },
  lst_liquidity_drain: { kind: "lst_liquidity_drain", label: "LST liquidity drain −12%", params: { liquidityHaircutPct: -12 } },
  validator_outage: { kind: "validator_outage", label: "Validator outage", params: {} },
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  const scenarioKey = url.searchParams.get("scenario") || "sol_crash";
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  let scenario: LabScenario = PRESETS[scenarioKey];
  if (!scenario) {
    // custom: ?scenario=custom&asset=SOL&movePct=-30
    const asset = url.searchParams.get("asset") || undefined;
    const movePct = Number(url.searchParams.get("movePct") ?? -20);
    scenario = {
      kind: (scenarioKey as LabScenarioKind) || "custom",
      label: `Custom ${asset ?? ""} ${movePct}%`.trim(),
      params: { asset, movePct },
    };
  }

  try {
    const { positions, totalUsd } = await resolveAddressPositions(address);
    const result = runStress(positions, scenario);
    return NextResponse.json({ positions, totalUsd, result, presets: Object.keys(PRESETS) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
