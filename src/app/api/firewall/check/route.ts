export const runtime = "edge";
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

/**
 * Deserialize a base64 VersionedTransaction, extract every program +
 * writable account, and score them with Webacy in parallel. Returns
 * `null` when we can't extract anything usable — never throws.
 */
async function buildWebacySummary(serializedTxBase64: string) {
  const raw = Buffer.from(serializedTxBase64, "base64");
  const tx = VersionedTransaction.deserialize(new Uint8Array(raw));
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());

  const programIdxs = new Set<number>();
  for (const ix of msg.compiledInstructions) programIdxs.add(ix.programIdIndex);

  // Writable accounts (destinations we actually mutate).
  const writable = new Set<string>();
  const numRequiredSignatures = msg.header.numRequiredSignatures;
  const numReadonlySigned = msg.header.numReadonlySignedAccounts;
  const numReadonlyUnsigned = msg.header.numReadonlyUnsignedAccounts;
  const signedWritable = numRequiredSignatures - numReadonlySigned;
  const totalStatic = keys.length;
  const unsignedWritable = totalStatic - numRequiredSignatures - numReadonlyUnsigned;
  for (let i = 0; i < signedWritable; i++) writable.add(keys[i]!);
  for (let i = numRequiredSignatures; i < numRequiredSignatures + unsignedWritable; i++) writable.add(keys[i]!);

  const programIds = Array.from(programIdxs).map((i) => keys[i]!).filter(Boolean);
  const subjects = Array.from(new Set([...programIds, ...writable]));
  if (subjects.length === 0) return null;

  const scores = await scoreAddresses(subjects, "sol");
  return {
    worst: worstOfMap(scores),
    addresses: Array.from(scores.values()),
  };
}
