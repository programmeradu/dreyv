/**
 * GET /api/case-study/[address]
 *
 * Returns a CaseStudyReport for any public Solana address.
 * Used by /case/[address] (server-rendered) and /studio/case-studies (preview).
 *
 * ?label=... ?kind=...  optional human-readable label + kind chip
 */
import { NextRequest, NextResponse } from "next/server";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
import { checkPublicRateLimit } from "@/lib/public-rate-limit";
import { buildCaseStudy } from "@/lib/case-study/builder";
import { findFeatured } from "@/lib/case-study/featured";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }
  const rl = checkPublicRateLimit(req, { bucket: "case-study", max: 12 });
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const url = new URL(req.url);
  const featured = findFeatured(address);
  const label = url.searchParams.get("label") || featured?.label || "";
  const kind = url.searchParams.get("kind") || featured?.kind || null;

  try {
    const report = await buildCaseStudy(address, label, kind);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "case_study_failed" },
      { status: 500 },
    );
  }
}
