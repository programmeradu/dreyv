/**
 * /case/[address]: public, pitch-ready case study for a Solana treasury.
 *
 * Server-rendered: builds the report at request time using the same
 * live data sources as /v/[address]. Counterfactual framing is explicit
 * at the top of the page.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidSolanaAddress } from "@/lib/atlas-utils";
import { buildCaseStudy } from "@/lib/case-study/builder";
import { findFeatured } from "@/lib/case-study/featured";
import { SiteHeader, SiteFooter } from "@/components/marketing/legacy-chrome";
import { CaseStudyReportView } from "@/components/case-study/CaseStudyReportView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const featured = findFeatured(address);
  const label = featured?.label ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
  return {
    title: `${label}: dreyv case study`,
    description: `What dreyv would have flagged on ${label}, from live on-chain data: idle yield, fees, concentration and approvals.`,
    alternates: { canonical: `/case/${address}` },
    openGraph: {
      title: `${label}: dreyv case study`,
      description: "What dreyv would have flagged, from live public on-chain data.",
    },
    robots: { index: true, follow: true },
  };
}

export default async function CaseStudyPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isValidSolanaAddress(address)) notFound();

  const featured = findFeatured(address);
  const report = await buildCaseStudy(address, featured?.label ?? "", featured?.kind ?? null);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <CaseStudyReportView report={report} />
      <SiteFooter />
    </div>
  );
}
