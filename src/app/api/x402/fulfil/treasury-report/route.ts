/**
 * GET /api/x402/fulfil/treasury-report?wallet=<addr>
 *
 * SKU: dreyv.treasury.report ($1.00)
 *
 * Auth: `Authorization: Bearer rcpt_…` (single-use receipt).
 *
 * Returns a full AI-written treasury report: composition, concentration,
 * runway, risk, suggestions — grounded on live Helius DAS data for the
 * requested Solana wallet. Falls back to a deterministic report if the
 * AI provider is unavailable so the agent never gets an empty payload.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { buildLiveVaultSnapshot, type LiveVaultSnapshot } from "@/lib/benchmark/vault-live";
import {
    extractReceiptToken,
    receiptErrorStatus,
    redeemReceipt,
} from "@/lib/agent/receipts";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface ReportMetrics {
    totalUsd: number;
    stableUsd: number;
    nonStableUsd: number;
    stableShare: number;
    topConcentrationShare: number;
    topConcentrationSymbol: string | null;
    hhi: number; // Herfindahl–Hirschman concentration index, 0..10000
    holdings: number;
}

const STABLES = new Set(["USDC", "USDT", "PYUSD", "USDS", "DAI", "USDH", "USDR"]);

function computeMetrics(snap: LiveVaultSnapshot): ReportMetrics {
    const valued = snap.holdings.filter((h) => (h.usd ?? 0) > 0);
    const total = valued.reduce((s, h) => s + (h.usd ?? 0), 0);
    const stable = valued
        .filter((h) => STABLES.has((h.symbol || "").toUpperCase()))
        .reduce((s, h) => s + (h.usd ?? 0), 0);
    const top = valued[0];
    const hhi = total > 0
        ? valued.reduce((s, h) => {
            const share = ((h.usd ?? 0) / total) * 100;
            return s + share * share;
        }, 0)
        : 0;
    return {
        totalUsd: total,
        stableUsd: stable,
        nonStableUsd: total - stable,
        stableShare: total > 0 ? stable / total : 0,
        topConcentrationShare: total > 0 && top?.usd ? top.usd / total : 0,
        topConcentrationSymbol: top?.symbol ?? null,
        hhi: Math.round(hhi),
        holdings: valued.length,
    };
}

function deterministicReport(snap: LiveVaultSnapshot, m: ReportMetrics): string {
    const fmtUsd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const concentration =
        m.hhi >= 5000 ? "highly concentrated"
            : m.hhi >= 2500 ? "moderately concentrated"
                : "reasonably diversified";
    const runwayMonths = m.stableUsd > 0 ? Math.floor(m.stableUsd / 25_000) : 0;
    const lines = [
        `# Treasury Report — ${snap.address}`,
        ``,
        `**As of:** ${snap.asOf}`,
        `**Total value:** ${fmtUsd(m.totalUsd)} across ${m.holdings} fungible holdings`,
        ``,
        `## Composition`,
        `- Stablecoins: ${fmtUsd(m.stableUsd)} (${pct(m.stableShare)})`,
        `- Volatile assets: ${fmtUsd(m.nonStableUsd)} (${pct(1 - m.stableShare)})`,
        `- Largest position: ${m.topConcentrationSymbol ?? "n/a"} at ${pct(m.topConcentrationShare)} of book`,
        ``,
        `## Concentration & risk`,
        `Portfolio is **${concentration}** (HHI ${m.hhi}/10000).`,
        m.topConcentrationShare > 0.5
            ? `Single-asset concentration above 50% — a sharp drawdown in ${m.topConcentrationSymbol} would dominate P&L.`
            : `No single asset exceeds 50% of book.`,
        ``,
        `## Runway`,
        m.stableUsd > 0
            ? `At a $25k/month burn, the stable buffer covers roughly ${runwayMonths} month(s) without touching volatile inventory.`
            : `No stablecoin buffer detected — every monthly expense forces a sale of volatile inventory at prevailing prices.`,
        ``,
        `## Suggestions`,
        m.stableShare < 0.15
            ? `- Build a stable runway: route 10–20% of new inflows to USDC until the buffer covers 6 months of opex.`
            : `- Stable allocation is healthy; consider laddering excess USDC into 1-month T-bills or Marinade native stake for non-runway capital.`,
        m.topConcentrationShare > 0.4
            ? `- Trim the top position toward 30% via a 4-week DCA-out into USDC to reduce single-asset risk.`
            : `- Concentration is acceptable; no forced rebalance required this cycle.`,
        snap.nftCount > 0
            ? `- ${snap.nftCount} NFT(s) present — value separately; this report covers fungible holdings only.`
            : `- No NFTs detected on this wallet.`,
    ];
    return lines.join("\n");
}

async function aiReport(snap: LiveVaultSnapshot, m: ReportMetrics): Promise<string | null> {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) return null;
    try {
        const groq = createGroq({ apiKey });
        const holdingsSummary = snap.holdings
            .filter((h) => (h.usd ?? 0) > 0)
            .slice(0, 20)
            .map((h) => `- ${h.symbol}: ${h.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ $${(h.priceUsd ?? 0).toFixed(4)} = $${(h.usd ?? 0).toFixed(2)}`)
            .join("\n");
        const prompt = `You are Dreyv's treasury analyst. Write a precise, founder-to-founder treasury report in markdown. Calm, no hype, no emoji, no "revolutionize"/"supercharge"/"leverage".

Wallet: ${snap.address}
As of: ${snap.asOf}
Total: $${m.totalUsd.toFixed(2)} across ${m.holdings} fungible positions
Stable: $${m.stableUsd.toFixed(2)} (${(m.stableShare * 100).toFixed(1)}%)
Top position: ${m.topConcentrationSymbol ?? "n/a"} (${(m.topConcentrationShare * 100).toFixed(1)}% of book)
HHI: ${m.hhi}/10000
NFT count: ${snap.nftCount}

Holdings:
${holdingsSummary}

Cover, in this order, as markdown sections: Composition, Concentration & risk, Runway (assume $25k/month opex unless stables are absent), Drift vs a 60/40 stable/volatile target, Actionable suggestions (3–5, each with a specific size or trigger). Keep it under 500 words.`;
        const { text } = await generateText({
            model: groq("llama-3.3-70b-versatile"),
            prompt,
            temperature: 0.2,
        });
        return text?.trim() || null;
    } catch {
        return null;
    }
}

export async function GET(req: NextRequest) {
    const token = extractReceiptToken(req);
    if (!token) {
        return NextResponse.json(
            { error: "missing_receipt", hint: "Authorization: Bearer rcpt_…" },
            { status: 401 },
        );
    }

    const wallet = req.nextUrl.searchParams.get("wallet")?.trim();
    if (!wallet || !SOLANA_ADDR_RE.test(wallet)) {
        return NextResponse.json(
            { error: "invalid_wallet", hint: "?wallet=<solana_address>" },
            { status: 400 },
        );
    }

    const redeem = await redeemReceipt(token, "dreyv.treasury.report");
    if (!redeem.ok) {
        return NextResponse.json(
            { error: redeem.error },
            { status: receiptErrorStatus(redeem.error!) },
        );
    }

    try {
        const snap = await buildLiveVaultSnapshot(wallet);
        const metrics = computeMetrics(snap);
        const aiText = await aiReport(snap, metrics);
        const report = aiText ?? deterministicReport(snap, metrics);
        return NextResponse.json({
            sku: "dreyv.treasury.report",
            wallet,
            as_of: snap.asOf,
            total_usd: snap.totalUsd,
            metrics: {
                stable_usd: metrics.stableUsd,
                stable_share: metrics.stableShare,
                top_symbol: metrics.topConcentrationSymbol,
                top_share: metrics.topConcentrationShare,
                hhi: metrics.hhi,
                fungible_count: metrics.holdings,
                nft_count: snap.nftCount,
            },
            report_markdown: report,
            generated_by: aiText ? "groq:llama-3.3-70b" : "deterministic",
            source: snap.source,
            warning: snap.warning ?? null,
            receipt: { id: redeem.receipt!.payment.id, consumed: true },
        });
    } catch (e) {
        return NextResponse.json(
            { error: "fulfilment_failed", detail: e instanceof Error ? e.message : "unknown" },
            { status: 500 },
        );
    }
}
