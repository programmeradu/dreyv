/**
 * POST /api/firewall/check
 *
 * Exposes the Simulation Firewall to external callers (Studio mini-apps,
 * marketplace agents, third-party integrations). Runs the same pre-flight
 * + on-chain simulation + policy evaluation pipeline used by the
 * coordinator, and returns a structured report.
 *
 * Body:
 *   {
 *     quote?:        Jupiter-style quote object (for pre-flight),
 *     serializedTx?: base64-encoded VersionedTransaction (for sim),
 *     signer?:       base58 public key of the intended signer
 *   }
 *
 * Returns:
 *   200 OK   — { passed: true, report, simResult, evaluation }
 *   400 Bad — { passed: false, violations, riskLevel, ...details }
 */

import { NextRequest, NextResponse } from "next/server";
import { SimulationFirewall } from "@/lib/studio/simulation-firewall";
import { DEFAULT_POLICY, FirewallBlockedError, evaluate } from "@/lib/firewall/policy";
import { scoreAddresses, worstOfMap, isWebacyEnabled } from "@/lib/webacy/service";
import { VersionedTransaction } from "@solana/web3.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { quote, serializedTx, signer } = body || {};

    if (!quote && !serializedTx) {
      return NextResponse.json(
        { passed: false, error: "Missing both `quote` and `serializedTx` — at least one required" },
        { status: 400 }
      );
    }

    const firewall = SimulationFirewall.getInstance();

    const report = quote ? firewall.protect(quote) : null;

    let simResult = null;
    if (serializedTx) {
      if (!signer) {
        return NextResponse.json(
          { passed: false, error: "`signer` public key required when supplying `serializedTx`" },
          { status: 400 }
        );
      }
      try {
        simResult = await firewall.simulate(serializedTx, signer);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          {
            passed: false,
            riskLevel: "critical",
            violations: [message],
            report,
            blockedReason: message,
          },
          { status: 400 }
        );
      }
    }

    // ─── Webacy address risk fan-out (Simulation Firewall) ─────────
    // Extract every program + writable account from the serialized tx and
    // score them in parallel. Fail-open: if Webacy is disabled or errors,
    // we simply skip the check — policy only blocks on returned `high`.
    let webacySummary: Awaited<ReturnType<typeof buildWebacySummary>> = null;
    if (serializedTx && isWebacyEnabled()) {
      try {
        webacySummary = await buildWebacySummary(serializedTx);
      } catch (err) {
        console.warn("[firewall/check] webacy fan-out failed:", err);
      }
    }

    const evaluation = evaluate(report, simResult, DEFAULT_POLICY, webacySummary);

    if (!evaluation.passed) {
      return NextResponse.json(
        {
          passed: false,
          riskLevel: evaluation.riskLevel,
          violations: evaluation.violations,
          report,
          simResult,
          webacy: webacySummary,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      passed: true,
      riskLevel: evaluation.riskLevel,
      report,
      simResult,
      webacy: webacySummary,
      evaluation,
    });
  } catch (err) {
    if (err instanceof FirewallBlockedError) {
      return NextResponse.json(
        { passed: false, riskLevel: err.riskLevel, violations: err.violations, error: err.message },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ passed: false, error: message }, { status: 500 });
  }
}
