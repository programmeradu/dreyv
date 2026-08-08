import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { jwtVerify } from "jose";
import { transactionCache, dcaExecutions, purchases } from "@/db/schema";

export const dynamic = "force-dynamic";

function getAdminToken(req: NextRequest) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) return authHeader.substring(7);
    return (
        req.cookies.get("keystone-siws-session")?.value ??
        req.cookies.get("better-auth.session_token")?.value ??
        req.cookies.get("__Secure-neon-auth.session_token")?.value ??
        req.cookies.get("neon-auth.session_token")?.value ??
        null
    );
}

const KNOWN_PROGRAMS: Record<string, string> = {
    JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter v6",
    JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB: "Jupiter v4",
    "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP": "Orca Whirlpool",
    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM",
    SquadsMPL11111111111111111111111111111111111: "Squads multisig",
    "11111111111111111111111111111111": "System (SOL transfer)",
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
    ComputeBudget111111111111111111111111111111: "Compute budget",
};

function programLabel(pid: string | null): string {
    if (!pid) return "Unknown";
    return KNOWN_PROGRAMS[pid] ?? `${pid.slice(0, 6)}…${pid.slice(-4)}`;
}

async function buildReport(rangeDays: number) {
    if (!db) throw new Error("no_db");
    const dbx = db;
    const since = new Date(Date.now() - rangeDays * 86400_000);

    const [
        byType,
        byProgram,
        byChain,
        monthlyTx,
        monthlyDca,
        monthlyMarketplace,
        totalsTx,
        totalsDca,
        totalsMp,
    ] = await Promise.all([
        dbx
            .select({
                type: transactionCache.type,
                count: sql<number>`count(*)::int`,
                volume: sql<number>`coalesce(sum(value_usd), 0)::float`,
            })
            .from(transactionCache)
            .where(sql`block_time >= ${since}`)
            .groupBy(transactionCache.type),
        dbx
            .select({
                programId: transactionCache.programId,
                count: sql<number>`count(*)::int`,
                volume: sql<number>`coalesce(sum(value_usd), 0)::float`,
            })
            .from(transactionCache)
            .where(sql`block_time >= ${since}`)
            .groupBy(transactionCache.programId)
            .orderBy(sql`count(*) desc`)
            .limit(15),
        // transactionCache is Solana-only; placeholder structure for future chains
        dbx
            .select({
                count: sql<number>`count(*)::int`,
                volume: sql<number>`coalesce(sum(value_usd), 0)::float`,
            })
            .from(transactionCache)
            .where(sql`block_time >= ${since}`),
        dbx.execute(sql`
            select to_char(date_trunc('month', block_time), 'YYYY-MM') as month,
                   count(*)::int as count,
                   coalesce(sum(value_usd), 0)::float as volume
            from transaction_cache
            where block_time >= ${since}
            group by 1 order by 1 asc
        `),
        dbx.execute(sql`
            select to_char(date_trunc('month', executed_at), 'YYYY-MM') as month,
                   count(*)::int as count,
                   coalesce(sum(payment_amount), 0)::float as volume
            from dca_executions
            where executed_at >= ${since}
            group by 1 order by 1 asc
        `),
        dbx.execute(sql`
            select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
                   count(*)::int as count,
                   coalesce(sum(amount_usdc), 0)::float as volume
            from purchases
            where created_at >= ${since}
            group by 1 order by 1 asc
        `),
        dbx
            .select({
                count: sql<number>`count(*)::int`,
                volume: sql<number>`coalesce(sum(value_usd), 0)::float`,
                fees: sql<number>`coalesce(sum(fee), 0)::float`,
            })
            .from(transactionCache)
            .where(sql`block_time >= ${since}`),
        dbx
            .select({
                count: sql<number>`count(*)::int`,
                volume: sql<number>`coalesce(sum(payment_amount), 0)::float`,
            })
            .from(dcaExecutions)
            .where(sql`executed_at >= ${since}`),
        dbx
            .select({
                count: sql<number>`count(*)::int`,
                volume: sql<number>`coalesce(sum(amount_usdc), 0)::float`,
                fees: sql<number>`coalesce(sum(keystone_fee), 0)::float`,
            })
            .from(purchases)
            .where(sql`created_at >= ${since}`),
    ]);

    // merge monthly streams
    const monthMap: Record<
        string,
        { month: string; tx: number; txVol: number; dca: number; dcaVol: number; mp: number; mpVol: number }
    > = {};
    const ensure = (m: string) =>
        (monthMap[m] ??= { month: m, tx: 0, txVol: 0, dca: 0, dcaVol: 0, mp: 0, mpVol: 0 });
    for (const r of (monthlyTx as any).rows ?? monthlyTx) {
        const row = ensure(r.month);
        row.tx = Number(r.count) || 0;
        row.txVol = Number(r.volume) || 0;
    }
    for (const r of (monthlyDca as any).rows ?? monthlyDca) {
        const row = ensure(r.month);
        row.dca = Number(r.count) || 0;
        row.dcaVol = Number(r.volume) || 0;
    }
    for (const r of (monthlyMarketplace as any).rows ?? monthlyMarketplace) {
        const row = ensure(r.month);
        row.mp = Number(r.count) || 0;
        row.mpVol = Number(r.volume) || 0;
    }
    const monthly = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));

    return {
        rangeDays,
        generatedAt: new Date().toISOString(),
        totals: {
            onchain: totalsTx[0] ?? { count: 0, volume: 0, fees: 0 },
            dca: totalsDca[0] ?? { count: 0, volume: 0 },
            marketplace: totalsMp[0] ?? { count: 0, volume: 0, fees: 0 },
            allTxCount:
                (totalsTx[0]?.count ?? 0) + (totalsDca[0]?.count ?? 0) + (totalsMp[0]?.count ?? 0),
            allVolumeUsd:
                (totalsTx[0]?.volume ?? 0) + (totalsDca[0]?.volume ?? 0) + (totalsMp[0]?.volume ?? 0),
            allFeesUsd: (totalsTx[0]?.fees ?? 0) + (totalsMp[0]?.fees ?? 0),
        },
        byType: byType.map((r) => ({
            type: r.type ?? "unknown",
            count: Number(r.count) || 0,
            volume: Number(r.volume) || 0,
        })),
        byChain: [
            {
                chain: "solana",
                count: Number(byChain[0]?.count) || 0,
                volume: Number(byChain[0]?.volume) || 0,
            },
        ],
        byRouting: byProgram.map((r) => ({
            programId: r.programId ?? "unknown",
            label: programLabel(r.programId),
            count: Number(r.count) || 0,
            volume: Number(r.volume) || 0,
        })),
        monthly,
    };
}

export async function GET(req: NextRequest) {
    try {
        if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });
        const dbx = db;

        const token = getAdminToken(req);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        try {
            const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
            if (!jwtSecret) return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
            const result = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
            const wallet = (result.payload as any).wallet || (result.payload as any).sub;
            const u = await dbx.query.users.findFirst({
                where: (u, { eq }) => eq(u.walletAddress, wallet as string),
            });
            if (!u || u.role !== "admin")
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        } catch {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(req.url);
        const format = (url.searchParams.get("format") ?? "json").toLowerCase();
        const rangeDays = Math.max(1, Math.min(365, Number(url.searchParams.get("range") ?? "90")));
        const report = await buildReport(rangeDays);

        if (format === "csv") {
            const lines: string[] = [];
            const usd = (n: number) => n.toFixed(2);
            lines.push(`Dreyv Platform Transaction & Volume Report`);
            lines.push(`Generated,${report.generatedAt}`);
            lines.push(`Window,Last ${rangeDays} days`);
            lines.push("");
            lines.push("== TOTALS ==");
            lines.push("Stream,Count,Volume USD,Fees USD");
            lines.push(`On-chain,${report.totals.onchain.count},${usd(report.totals.onchain.volume)},${usd(report.totals.onchain.fees ?? 0)}`);
            lines.push(`DCA,${report.totals.dca.count},${usd(report.totals.dca.volume)},`);
            lines.push(`Marketplace,${report.totals.marketplace.count},${usd(report.totals.marketplace.volume)},${usd(report.totals.marketplace.fees ?? 0)}`);
            lines.push(`TOTAL,${report.totals.allTxCount},${usd(report.totals.allVolumeUsd)},${usd(report.totals.allFeesUsd)}`);
            lines.push("");
            lines.push("== BY TYPE ==");
            lines.push("Type,Count,Volume USD");
            for (const r of report.byType) lines.push(`${r.type},${r.count},${usd(r.volume)}`);
            lines.push("");
            lines.push("== BY CHAIN ==");
            lines.push("Chain,Count,Volume USD");
            for (const r of report.byChain) lines.push(`${r.chain},${r.count},${usd(r.volume)}`);
            lines.push("");
            lines.push("== BY ROUTING (top programs) ==");
            lines.push("Program,Program ID,Count,Volume USD");
            for (const r of report.byRouting)
                lines.push(`${r.label},${r.programId},${r.count},${usd(r.volume)}`);
            lines.push("");
            lines.push("== MONTHLY TIME SERIES ==");
            lines.push("Month,On-chain TX,On-chain Vol USD,DCA TX,DCA Vol USD,Marketplace TX,Marketplace Vol USD");
            for (const m of report.monthly)
                lines.push(`${m.month},${m.tx},${usd(m.txVol)},${m.dca},${usd(m.dcaVol)},${m.mp},${usd(m.mpVol)}`);
            return new Response(lines.join("\n"), {
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename="dreyv-platform-report-${rangeDays}d.csv"`,
                    "Cache-Control": "no-store",
                },
            });
        }

        if (format === "pdf") {
            const { default: jsPDF } = await import("jspdf");
            const doc = new jsPDF({ unit: "pt", format: "a4" });
            const W = doc.internal.pageSize.getWidth();
            let y = 56;
            const usd = (n: number) =>
                "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

            doc.setFont("helvetica", "bold");
            doc.setFontSize(20);
            doc.setTextColor(124, 58, 237);
            doc.text("Dreyv", 48, y);
            doc.setTextColor(15, 23, 42);
            doc.setFontSize(14);
            doc.text("Platform Transaction & Volume Report", 48, y + 22);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(100, 116, 139);
            doc.text(
                `Window: last ${rangeDays} days  ·  Generated ${new Date(report.generatedAt).toUTCString()}`,
                48,
                y + 40,
            );
            y += 70;

            const section = (title: string) => {
                if (y > 760) {
                    doc.addPage();
                    y = 56;
                }
                doc.setFont("helvetica", "bold");
                doc.setFontSize(11);
                doc.setTextColor(15, 23, 42);
                doc.text(title.toUpperCase(), 48, y);
                doc.setDrawColor(221, 214, 254);
                doc.line(48, y + 4, W - 48, y + 4);
                y += 18;
                doc.setFont("helvetica", "normal");
                doc.setFontSize(10);
                doc.setTextColor(51, 65, 85);
            };
            const row = (cells: string[], widths: number[]) => {
                if (y > 790) {
                    doc.addPage();
                    y = 56;
                }
                let x = 48;
                for (let i = 0; i < cells.length; i++) {
                    doc.text(cells[i], x, y, { maxWidth: widths[i] - 4 });
                    x += widths[i];
                }
                y += 14;
            };

            section("Headline totals");
            row(["Stream", "Count", "Volume", "Fees"], [200, 100, 120, 100]);
            row(
                ["On-chain (Solana)", String(report.totals.onchain.count), usd(report.totals.onchain.volume), usd(report.totals.onchain.fees ?? 0)],
                [200, 100, 120, 100],
            );
            row(["DCA executions", String(report.totals.dca.count), usd(report.totals.dca.volume), "—"], [200, 100, 120, 100]);
            row(
                ["Marketplace purchases", String(report.totals.marketplace.count), usd(report.totals.marketplace.volume), usd(report.totals.marketplace.fees ?? 0)],
                [200, 100, 120, 100],
            );
            doc.setFont("helvetica", "bold");
            row(["TOTAL", String(report.totals.allTxCount), usd(report.totals.allVolumeUsd), usd(report.totals.allFeesUsd)], [200, 100, 120, 100]);
            doc.setFont("helvetica", "normal");
            y += 8;

            section("Volume by type");
            row(["Type", "Count", "Volume"], [200, 120, 140]);
            for (const r of report.byType) row([r.type, String(r.count), usd(r.volume)], [200, 120, 140]);
            y += 8;

            section("Volume by chain");
            row(["Chain", "Count", "Volume"], [200, 120, 140]);
            for (const r of report.byChain) row([r.chain, String(r.count), usd(r.volume)], [200, 120, 140]);
            y += 8;

            section("Top routing destinations (programs)");
            row(["Program", "Count", "Volume"], [260, 100, 140]);
            for (const r of report.byRouting) row([r.label, String(r.count), usd(r.volume)], [260, 100, 140]);
            y += 8;

            section("Monthly time series");
            row(["Month", "On-chain Tx", "On-chain Vol", "DCA Tx", "DCA Vol", "Mkt Tx", "Mkt Vol"], [60, 70, 80, 60, 70, 60, 80]);
            for (const m of report.monthly)
                row(
                    [m.month, String(m.tx), usd(m.txVol), String(m.dca), usd(m.dcaVol), String(m.mp), usd(m.mpVol)],
                    [60, 70, 80, 60, 70, 60, 80],
                );

            const pdfBytes = doc.output("arraybuffer");
            return new Response(pdfBytes, {
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": `attachment; filename="dreyv-platform-report-${rangeDays}d.pdf"`,
                    "Cache-Control": "no-store",
                },
            });
        }

        return NextResponse.json(report);
    } catch (e: any) {
        console.error("platform-report error:", e);
        return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
    }
}
