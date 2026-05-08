/**
 * /v/[address] — Public read-only vault preview.
 *
 * Sid's pitch: a visitor pastes any public Solana address on the homepage,
 * lands here, sees actual analytics from real APIs (no wallet sign required),
 * and converts. No agent execution, no DB writes, no command history.
 *
 * Data sources (server-side fetch, public, soft-rate-limited):
 *   - /api/helius/das/wallet-holdings   token holdings + native balance
 *   - /api/analytics/fees                fees paid in last 6mo
 *   - /api/yield/rates                   current LST yield opportunities
 *   - /api/treasury/security             public hygiene audit (no PII)
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteOrigin } from "@/lib/seo/site";
import { PublicVaultClient } from "@/components/public/PublicVaultClient";
import { isValidSolanaAddress } from "@/lib/atlas-utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Holding {
  mint: string;
  symbol: string;
  name?: string;
  balance: string;
  amount?: string;
  decimals: number;
  logo?: string;
}

interface FeesPayload {
  totalFeeUsd?: number;
  totalFeeSol?: number;
  transactionCount?: number;
  byType?: Array<{ type: string; totalFees: number; count: number }>;
  daily?: Array<{ date: string; totalFees: number; txCount: number }>;
}

interface YieldRateEntry {
  apy: number;
  source: "live" | "estimated";
  protocol: string;
  symbol: string;
  riskTier: "low" | "medium" | "high";
  aumUsd?: number;
}

interface SecurityAudit {
  score: number;
  findings: Array<{ severity: "info" | "warn" | "high"; code: string; message: string }>;
  isMultisig: boolean;
  threshold: number | null;
  signers: Array<{ address: string; label?: string }>;
}

interface PageData {
  holdings: Holding[];
  fees: FeesPayload | null;
  yieldRates: Record<string, YieldRateEntry>;
  audit: SecurityAudit | null;
}

async function fetchAll(address: string): Promise<PageData> {
  const base = getSiteOrigin();
  const safe = encodeURIComponent(address);

  // Tag every public-mode call so the API can apply tighter rate limits and
  // strip any owner-only fields. Endpoints already work without auth; the
  // `?public=1` flag lets us harden them later without touching this page.
  const [holdingsRes, feesRes, yieldRes, auditRes] = await Promise.all([
    fetch(`${base}/api/helius/das/wallet-holdings?address=${safe}&public=1`, {
      cache: "no-store",
    }).catch(() => null),
    fetch(`${base}/api/analytics/fees?address=${safe}&months=6&public=1`, {
      cache: "no-store",
    }).catch(() => null),
    fetch(`${base}/api/yield/rates`, { cache: "no-store" }).catch(() => null),
    fetch(`${base}/api/treasury/security?wallet=${safe}&public=1`, {
      cache: "no-store",
    }).catch(() => null),
  ]);

  const holdings: Holding[] = await (async () => {
    if (!holdingsRes || !holdingsRes.ok) return [];
    try {
      const j = await holdingsRes.json();
      return Array.isArray(j?.holdings) ? j.holdings : [];
    } catch {
      return [];
    }
  })();

  const fees: FeesPayload | null = await (async () => {
    if (!feesRes || !feesRes.ok) return null;
    try {
      const j = await feesRes.json();
      if (j?.error) return null;
      return j as FeesPayload;
    } catch {
      return null;
    }
  })();

  const yieldRates: Record<string, YieldRateEntry> = await (async () => {
    if (!yieldRes || !yieldRes.ok) return {};
    try {
      const j = await yieldRes.json();
      return j?.rates && typeof j.rates === "object" ? j.rates : {};
    } catch {
      return {};
    }
  })();

  const audit: SecurityAudit | null = await (async () => {
    if (!auditRes || !auditRes.ok) return null;
    try {
      const j = await auditRes.json();
      const a = j?.audit;
      if (!a) return null;
      return {
        score: Number(a.score ?? 50),
        findings: Array.isArray(a.findings) ? a.findings : [],
        isMultisig: Boolean(a.isMultisig),
        threshold: a.threshold ?? null,
        signers: Array.isArray(a.signers) ? a.signers : [],
      };
    } catch {
      return null;
    }
  })();

  return { holdings, fees, yieldRates, audit };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  return {
    title: `Vault preview · ${address.slice(0, 4)}…${address.slice(-4)} · Dreyv`,
    description:
      "Read-only Dreyv preview: holdings, fees paid, idle yield, and security findings for any Solana wallet.",
    robots: { index: false, follow: false },
  };
}

export default async function PublicVaultPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) notFound();

  const data = await fetchAll(address);

  return (
    <main className="min-h-screen bg-white text-slate-900 font-[Manrope]">
      {/* Header glow */}
      <div className="relative overflow-hidden border-b border-violet-200/60">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-violet-400/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-10 h-[260px] w-[420px] rounded-full bg-violet-300/30 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 py-12">
          <div className="flex items-center justify-between gap-4 text-xs uppercase tracking-[0.18em] text-violet-700">
            <Link href="/" className="font-semibold">
              Dreyv
            </Link>
            <span className="rounded-full border border-violet-300 bg-white/70 px-3 py-1 text-[10px]">
              Read-only preview
            </span>
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            What Dreyv would do for{" "}
            <span className="font-mono text-violet-700">
              {address.slice(0, 4)}…{address.slice(-4)}
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-600">
            Real Helius + Jupiter + yield data — no wallet signature needed. Connect
            yours when you&apos;re ready to act on these opportunities.
          </p>
        </div>
      </div>

      <PublicVaultClient address={address} data={data} />
    </main>
  );
}
