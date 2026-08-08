/**
 * /v/[address] — Smart wallet explorer (v2).
 *
 * Param accepts:
 *   - Solana base58 address → SmartExplorerClient
 *   - 0x EVM address        → EvmExplorerClient (basic holdings + claim)
 *   - .sol / .eth handle    → resolved via /api/public/resolve, then redirect
 *
 * Query params:
 *   - ?compare=<addr>  side-by-side comparison
 *   - ?embed=1         strip chrome for embedding
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSiteOrigin } from "@/lib/seo/site";
import { SmartExplorerClient } from "@/components/public/SmartExplorerClient";
import { EvmExplorerClient } from "@/components/public/EvmExplorerClient";
import { detectAddressKind } from "@/lib/explorer/chain";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
    const { address } = await params;
    const base = getSiteOrigin();
    return {
        title: `${address.slice(0, 4)}…${address.slice(-4)} · Dreyv smart explorer`,
        description: "AI-narrated wallet report: archetype, PnL, risk, counterparties, suggested moves. Real Helius + Jupiter data, no signature needed.",
        openGraph: {
            title: `${address.slice(0, 4)}…${address.slice(-4)} · Dreyv`,
            description: "AI-narrated wallet report with PnL, risk, and suggested moves.",
            images: [`${base}/v/${address}/opengraph-image`],
        },
        robots: { index: false, follow: false },
    };
}

async function resolveHandle(handle: string): Promise<string | null> {
    try {
        const base = getSiteOrigin();
        const r = await fetch(`${base}/api/public/resolve/${encodeURIComponent(handle)}`, { cache: "no-store" });
        if (!r.ok) return null;
        const j = await r.json();
        return typeof j?.address === "string" ? j.address : null;
    } catch {
        return null;
    }
}

export default async function PublicVaultPage({
    params,
    searchParams,
}: {
    params: Promise<{ address: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { address } = await params;
    const sp = await searchParams;
    const compareParam = typeof sp.compare === "string" ? sp.compare : undefined;
    const embed = sp.embed === "1";

    const kind = detectAddressKind(address);
    if (kind === "invalid") notFound();

    if (kind === "handle-sol" || kind === "handle-eth") {
        const resolved = await resolveHandle(address);
        if (!resolved) notFound();
        redirect(`/v/${resolved}${compareParam ? `?compare=${compareParam}` : ""}`);
    }

    const main = (
        <main className={`min-h-screen bg-white text-slate-900 font-[Manrope] ${embed ? "" : ""}`}>
            {kind === "evm" ? (
                <EvmExplorerClient address={address} embed={embed} />
            ) : (
                <SmartExplorerClient address={address} compareAddress={compareParam} embed={embed} />
            )}
        </main>
    );

    return main;
}
