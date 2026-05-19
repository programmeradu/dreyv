/**
 * /api/treasury/security — wallet & asset security audit per vault.
 *
 *   GET    ?wallet=…              latest audit (single)
 *   GET    ?wallet=…&public=1     slimmed audit + soft IP rate limit; runs an
 *                                 on-demand audit when no row exists so the
 *                                 marketing /v/[address] preview always has
 *                                 something to render.
 *   POST   { wallet }             run a fresh audit (signers, threshold, findings)
 *   DELETE ?wallet=…
 */
import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth-utils";
import { db } from "@/db";
import { treasurySecurityAudits, vaults } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { resolveUserIdFromWallet } from "@/lib/agents/brains/storage";
import { publicRateLimitOrResponse } from "@/lib/public-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const isPublic = url.searchParams.get("public") === "1";
  if (!wallet) return NextResponse.json({ ok: true, audit: null });

  // Auth required for the full audit; ?public=1 stays open (rate-limited).
  if (!isPublic) {
    const _authUser = await getAuthUser(req as unknown as NextRequest);
    if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }


  if (isPublic) {
    const limited = publicRateLimitOrResponse(req, {
      bucket: "treasury-security",
      max: 30,
      windowMs: 60_000,
    });
    if (limited) return limited;
  }

  if (!db) {
    if (isPublic) {
      // No DB available — synthesize a minimal hygiene snapshot so the public
      // preview still renders. Covers cold-start preview deploys.
      const audit = await runAudit(wallet);
      return NextResponse.json({ ok: true, audit: slimAudit(audit, wallet) });
    }
    return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  }

  const [row] = await db.select().from(treasurySecurityAudits)
    .where(eq(treasurySecurityAudits.vaultAddress, wallet))
    .orderBy(desc(treasurySecurityAudits.createdAt))
    .limit(1);

  if (isPublic) {
    if (row) {
      return NextResponse.json({ ok: true, audit: slimAudit(row, wallet) });
    }
    // No prior audit — run one on the fly (no DB write) so visitors always
    // see useful findings on /v/[address].
    const fresh = await runAudit(wallet);
    return NextResponse.json({ ok: true, audit: slimAudit(fresh, wallet) });
  }

  return NextResponse.json({ ok: true, audit: row ?? null });
}

/**
 * Slim a security audit for public consumption: strip rich PII fields and
 * cap finding count. Accepts both the in-memory shape returned by runAudit
 * and the persisted row shape from treasurySecurityAudits.
 */
function slimAudit(
  audit: any,
  wallet: string,
): {
  score: number;
  findings: Finding[];
  isMultisig: boolean;
  threshold: number | null;
  signers: { address: string; label?: string }[];
  vaultAddress: string;
} {
  const findings: Finding[] = Array.isArray(audit?.findings)
    ? (audit.findings as Finding[]).slice(0, 6)
    : [];
  const signers: { address: string; label?: string }[] = Array.isArray(audit?.signers)
    ? (audit.signers as { address: string; label?: string }[]).slice(0, 6)
    : [];
  return {
    score: Number(audit?.score ?? 0),
    findings,
    isMultisig: Boolean(audit?.isMultisig),
    threshold: audit?.threshold ?? null,
    signers,
    vaultAddress: wallet,
  };
}

interface Finding { severity: "info" | "warn" | "high"; code: string; message: string; }

async function runAudit(wallet: string) {
  const findings: Finding[] = [];
  const signers: { address: string; label?: string }[] = [];
  let threshold: number | null = null;
  let isMultisig = false;

  // 1. Vault row metadata (kind = multisig / connected / watch)
  if (db) {
    const [vault] = await db.select().from(vaults).where(eq(vaults.address, wallet)).limit(1);
    isMultisig = vault?.isMultisig ?? false;
    if (vault?.kind === "watch") {
      findings.push({ severity: "info", code: "watch-only", message: "Watch-only address — no signing keys held by Dreyv." });
    }
  }

  // 2. Try Squads multisig discovery (best-effort, fail soft)
  if (isMultisig) {
    try {
      const rpc = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [wallet, { encoding: "base64" }] }),
      });
      const json = await res.json();
      if (json?.result?.value) {
        // Detected on-chain account; signer enumeration would need the Squads SDK
        // — we mark presence and let the user confirm signers manually.
        findings.push({ severity: "info", code: "multisig-detected", message: "Multisig account confirmed on-chain. Add signer labels below." });
      }
    } catch { /* ignore */ }
  } else {
    signers.push({ address: wallet, label: "Owner" });
    findings.push({ severity: "warn", code: "single-sig", message: "Single-signer wallet — consider upgrading to a Squads multisig for treasuries above $25k." });
  }

  // 3. Hygiene checks
  if (!isMultisig) {
    findings.push({ severity: "warn", code: "no-cosigner", message: "No co-signer or recovery contact configured." });
  }

  // 4. Score: 100 minus 20 per high, 8 per warn
  let score = 100;
  for (const f of findings) {
    if (f.severity === "high") score -= 20;
    else if (f.severity === "warn") score -= 8;
  }
  if (score < 0) score = 0;

  return { findings, signers, threshold, isMultisig, score };
}

export async function POST(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { wallet } = body ?? {};
  if (!wallet) return NextResponse.json({ ok: false, error: "wallet_required" }, { status: 400 });
  const userId = await resolveUserIdFromWallet(wallet);
  const audit = await runAudit(wallet);
  const [row] = await db.insert(treasurySecurityAudits).values({
    userId, vaultAddress: wallet,
    score: audit.score,
    findings: audit.findings,
    signers: audit.signers,
    threshold: audit.threshold,
    isMultisig: audit.isMultisig,
    lastAuditAt: new Date(),
  }).returning();
  return NextResponse.json({ ok: true, audit: row });
}

export async function DELETE(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ ok: false, error: "wallet_required" }, { status: 400 });
  await db.delete(treasurySecurityAudits).where(eq(treasurySecurityAudits.vaultAddress, wallet));
  return NextResponse.json({ ok: true });
}
