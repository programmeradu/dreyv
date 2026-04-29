/**
 * /api/treasury/exports/report.pdf?wallet=…&range=30d
 *
 * Server-rendered Treasury Report PDF.
 *
 * Pulls the same window of treasury_events used by the CSV export and
 * the daily PnL roll-up used by /app/analytics, then renders a clean,
 * brand-aligned HTML report (white bg, solid violet accents, Manrope)
 * and converts it to PDF via Cloudflare Browser Rendering.
 *
 * Returns: application/pdf as a download.
 */
import { db } from "@/db";
import { treasuryEvents } from "@/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { pdf } from "@/lib/cloudflare/cf-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function fmtUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: Request) {
  if (!db) return new Response("no_db", { status: 500 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const range = url.searchParams.get("range") ?? "30d";
  if (!wallet) return new Response("wallet required", { status: 400 });

  const days = RANGE_DAYS[range] ?? 30;
  const since = new Date(Date.now() - days * 86400_000);

  // Pull recent events (cap to keep PDF tractable)
  const events = await db
    .select()
    .from(treasuryEvents)
    .where(
      and(
        eq(treasuryEvents.walletAddress, wallet),
        gte(treasuryEvents.occurredAt, since),
      ),
    )
    .orderBy(desc(treasuryEvents.occurredAt))
    .limit(250);

  // Aggregate totals by kind for the summary header
  const totals: Record<string, number> = {};
  for (const e of events as any[]) {
    const k = e.kind || "unknown";
    totals[k] = (totals[k] || 0) + Number(e.amountUsd || 0);
  }
  const inflow = totals["inflow"] || 0;
  const outflow = totals["outflow"] || 0;
  const yieldUsd = totals["yield"] || 0;
  const fee = totals["fee"] || 0;
  const net = inflow - Math.abs(outflow) + yieldUsd - Math.abs(fee);

  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const walletShort = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

  const rowsHtml = events
    .slice(0, 120)
    .map((e: any) => {
      const when = new Date(e.occurredAt).toISOString().slice(0, 16).replace("T", " ");
      const amt = Number(e.amountUsd || 0);
      const amtClass = amt >= 0 ? "pos" : "neg";
      return `
        <tr>
          <td class="muted mono">${escapeHtml(when)}</td>
          <td><span class="badge badge-${escapeHtml(e.kind || "unknown")}">${escapeHtml(e.kind || "unknown")}</span></td>
          <td>${escapeHtml(e.tokenSymbol || "—")}</td>
          <td class="num ${amtClass}">${fmtUsd(amt)}</td>
          <td class="muted mono">${escapeHtml((e.counterparty || "").slice(0, 12) || "—")}</td>
          <td class="muted mono">${escapeHtml((e.signature || "").slice(0, 8) || "—")}</td>
        </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Dreyv Treasury Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root {
    --violet: #7c3aed;
    --violet-50: #f5f3ff;
    --violet-200: #ddd6fe;
    --violet-700: #6d28d9;
    --ink: #0f172a;
    --muted: #64748b;
    --line: #e2e8f0;
    --pos: #047857;
    --neg: #b91c1c;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: var(--ink);
    font-family: 'Manrope', system-ui, -apple-system, sans-serif;
    font-size: 11px;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { padding: 36px 40px; }
  .header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    border-bottom: 2px solid var(--violet);
    padding-bottom: 14px;
    margin-bottom: 20px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand-mark {
    width: 28px; height: 28px;
    background: var(--violet);
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 800; font-size: 14px;
  }
  .brand-name { font-weight: 800; font-size: 16px; letter-spacing: -0.01em; }
  .brand-sub { color: var(--muted); font-size: 10px; margin-top: 2px; }
  .meta { text-align: right; font-size: 10px; color: var(--muted); }
  .meta strong { color: var(--ink); font-weight: 700; }

  h1 {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
    margin: 0 0 4px;
  }
  .subtitle { color: var(--muted); font-size: 11px; margin-bottom: 20px; }

  .kpis {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px;
    margin-bottom: 22px;
  }
  .kpi {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
    background: #fff;
  }
  .kpi.primary {
    border-color: var(--violet);
    background: var(--violet-50);
  }
  .kpi-label { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
  .kpi-value { font-size: 16px; font-weight: 800; margin-top: 4px; letter-spacing: -0.01em; }
  .kpi-value.pos { color: var(--pos); }
  .kpi-value.neg { color: var(--neg); }
  .kpi-value.violet { color: var(--violet-700); }

  h2 {
    font-size: 13px;
    font-weight: 700;
    margin: 24px 0 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  th {
    text-align: left;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 9px;
    color: var(--muted);
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    background: #fafafa;
  }
  td {
    padding: 7px 10px;
    border-bottom: 1px solid var(--line);
    vertical-align: middle;
  }
  td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  td.pos { color: var(--pos); }
  td.neg { color: var(--neg); }
  td.muted { color: var(--muted); }
  .mono { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; }

  .badge {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: #f1f5f9;
    color: var(--ink);
  }
  .badge-inflow  { background: #dcfce7; color: #047857; }
  .badge-outflow { background: #fee2e2; color: #b91c1c; }
  .badge-yield   { background: var(--violet-50); color: var(--violet-700); }
  .badge-fee     { background: #fef3c7; color: #92400e; }
  .badge-swap    { background: #e0f2fe; color: #075985; }

  .empty {
    padding: 40px;
    text-align: center;
    color: var(--muted);
    border: 1px dashed var(--line);
    border-radius: 10px;
  }

  .footer {
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 9px;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="brand">
        <div class="brand-mark">D</div>
        <div>
          <div class="brand-name">Dreyv</div>
          <div class="brand-sub">Treasury OS · Report</div>
        </div>
      </div>
      <div class="meta">
        <div><strong>${escapeHtml(walletShort)}</strong></div>
        <div>Range: ${escapeHtml(range)} · Generated ${escapeHtml(generatedAt)}</div>
      </div>
    </div>

    <h1>Treasury Report</h1>
    <div class="subtitle">${events.length} events captured over the last ${days} day${days === 1 ? "" : "s"}.</div>

    <div class="kpis">
      <div class="kpi primary">
        <div class="kpi-label">Net</div>
        <div class="kpi-value ${net >= 0 ? "pos" : "neg"}">${fmtUsd(net)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Inflow</div>
        <div class="kpi-value pos">${fmtUsd(inflow)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Outflow</div>
        <div class="kpi-value neg">${fmtUsd(outflow)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Yield</div>
        <div class="kpi-value violet">${fmtUsd(yieldUsd)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Fees</div>
        <div class="kpi-value neg">${fmtUsd(fee)}</div>
      </div>
    </div>

    <h2>Recent Events</h2>
    ${events.length === 0
      ? `<div class="empty">No treasury events recorded in this window.</div>`
      : `<table>
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>Kind</th>
              <th>Token</th>
              <th style="text-align:right">Amount (USD)</th>
              <th>Counterparty</th>
              <th>Signature</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${events.length > 120 ? `<div class="subtitle" style="margin-top:10px">Showing first 120 of ${events.length} events. Export the full CSV for the complete dataset.</div>` : ""}
        `
    }

    <div class="footer">
      <div>Dreyv Treasury OS · dreyv.com</div>
      <div>Confidential — generated for ${escapeHtml(walletShort)}</div>
    </div>
  </div>
</body>
</html>`;

  try {
    const buf = await pdf({
      html,
      pdfOptions: {
        format: "A4",
        printBackground: true,
        margin: { top: "0", bottom: "0", left: "0", right: "0" },
      },
    });

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="dreyv-treasury-${range}-${wallet.slice(0, 8)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[treasury report.pdf] render failed", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "PDF render failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
