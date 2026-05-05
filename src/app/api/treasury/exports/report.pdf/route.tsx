/**
 * /api/treasury/exports/report.pdf?wallet=…&range=30d
 *
 * Server-rendered Treasury Report PDF — generated entirely in-process with
 * @react-pdf/renderer (no Cloudflare Browser Rendering, no headless Chrome).
 *
 * Pulls the same window of treasury_events used by the CSV export and
 * the daily PnL roll-up used by /app/analytics, then composes a clean,
 * brand-aligned PDF (white bg, solid violet accents).
 *
 * Returns: application/pdf as a download.
 */
import React from "react";
import { db } from "@/db";
import { treasuryEvents } from "@/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

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

const VIOLET = "#7c3aed";
const VIOLET_50 = "#f5f3ff";
const VIOLET_700 = "#6d28d9";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const POS = "#047857";
const NEG = "#b91c1c";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: VIOLET,
    paddingBottom: 10,
    marginBottom: 16,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandMark: {
    width: 24,
    height: 24,
    backgroundColor: VIOLET,
    borderRadius: 5,
    color: "#fff",
    fontSize: 13,
    fontWeight: 800,
    textAlign: "center",
    paddingTop: 4,
  },
  brandName: { fontSize: 14, fontWeight: 700, letterSpacing: -0.2 },
  brandSub: { fontSize: 8, color: MUTED, marginTop: 1 },
  meta: { fontSize: 8, color: MUTED, textAlign: "right" },
  metaStrong: { color: INK, fontWeight: 700, fontSize: 9 },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 2, letterSpacing: -0.3 },
  subtitle: { color: MUTED, fontSize: 9, marginBottom: 14 },
  kpis: { flexDirection: "row", gap: 6, marginBottom: 16 },
  kpi: {
    flex: 1,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 6,
    padding: 8,
  },
  kpiPrimary: { borderColor: VIOLET, backgroundColor: VIOLET_50 },
  kpiLabel: {
    fontSize: 7,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: 700,
  },
  kpiValue: { fontSize: 13, fontWeight: 700, marginTop: 3 },
  pos: { color: POS },
  neg: { color: NEG },
  violet: { color: VIOLET_700 },
  h2: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 4,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#fafafa",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  th: {
    fontSize: 7,
    color: MUTED,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingVertical: 5,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  cell: { fontSize: 8 },
  cellMono: { fontSize: 7.5, color: MUTED, fontFamily: "Courier" },
  cellNum: { fontSize: 8, fontWeight: 700, textAlign: "right" },
  badge: {
    fontSize: 7,
    fontWeight: 700,
    paddingVertical: 1,
    paddingHorizontal: 5,
    borderRadius: 3,
    backgroundColor: "#f1f5f9",
    color: INK,
    textTransform: "uppercase",
    alignSelf: "flex-start",
  },
  empty: {
    padding: 30,
    textAlign: "center",
    color: MUTED,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: LINE,
    borderRadius: 6,
    fontSize: 9,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 8,
    color: MUTED,
    fontSize: 7,
  },
});

const COL_WIDTHS = ["18%", "14%", "12%", "20%", "18%", "18%"] as const;

const badgeStyle = (kind: string) => {
  switch (kind) {
    case "inflow":
      return { backgroundColor: "#dcfce7", color: POS };
    case "outflow":
      return { backgroundColor: "#fee2e2", color: NEG };
    case "yield":
      return { backgroundColor: VIOLET_50, color: VIOLET_700 };
    case "fee":
      return { backgroundColor: "#fef3c7", color: "#92400e" };
    case "swap":
      return { backgroundColor: "#e0f2fe", color: "#075985" };
    default:
      return {};
  }
};

interface ReportProps {
  walletShort: string;
  range: string;
  generatedAt: string;
  days: number;
  events: any[];
  net: number;
  inflow: number;
  outflow: number;
  yieldUsd: number;
  fee: number;
}

function ReportDoc(props: ReportProps) {
  const { walletShort, range, generatedAt, days, events, net, inflow, outflow, yieldUsd, fee } = props;
  const rows = events.slice(0, 120);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.brandRow}>
            <Text style={styles.brandMark}>D</Text>
            <View>
              <Text style={styles.brandName}>Dreyv</Text>
              <Text style={styles.brandSub}>Treasury OS · Report</Text>
            </View>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaStrong}>{walletShort}</Text>
            <Text>Range: {range} · Generated {generatedAt}</Text>
          </View>
        </View>

        <Text style={styles.h1}>Treasury Report</Text>
        <Text style={styles.subtitle}>
          {events.length} events captured over the last {days} day{days === 1 ? "" : "s"}.
        </Text>

        <View style={styles.kpis}>
          <View style={[styles.kpi, styles.kpiPrimary]}>
            <Text style={styles.kpiLabel}>Net</Text>
            <Text style={[styles.kpiValue, net >= 0 ? styles.pos : styles.neg]}>{fmtUsd(net)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Inflow</Text>
            <Text style={[styles.kpiValue, styles.pos]}>{fmtUsd(inflow)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Outflow</Text>
            <Text style={[styles.kpiValue, styles.neg]}>{fmtUsd(outflow)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Yield</Text>
            <Text style={[styles.kpiValue, styles.violet]}>{fmtUsd(yieldUsd)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Fees</Text>
            <Text style={[styles.kpiValue, styles.neg]}>{fmtUsd(fee)}</Text>
          </View>
        </View>

        <Text style={styles.h2}>Recent Events</Text>

        {rows.length === 0 ? (
          <Text style={styles.empty}>No treasury events recorded in this window.</Text>
        ) : (
          <>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { width: COL_WIDTHS[0] }]}>When (UTC)</Text>
              <Text style={[styles.th, { width: COL_WIDTHS[1] }]}>Kind</Text>
              <Text style={[styles.th, { width: COL_WIDTHS[2] }]}>Token</Text>
              <Text style={[styles.th, { width: COL_WIDTHS[3], textAlign: "right" }]}>Amount (USD)</Text>
              <Text style={[styles.th, { width: COL_WIDTHS[4] }]}>Counterparty</Text>
              <Text style={[styles.th, { width: COL_WIDTHS[5] }]}>Signature</Text>
            </View>
            {rows.map((e: any, i: number) => {
              const when = new Date(e.occurredAt).toISOString().slice(0, 16).replace("T", " ");
              const amt = Number(e.amountUsd || 0);
              const kind = e.kind || "unknown";
              return (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[styles.cellMono, { width: COL_WIDTHS[0] }]}>{when}</Text>
                  <View style={{ width: COL_WIDTHS[1] }}>
                    <Text style={[styles.badge, badgeStyle(kind)]}>{kind}</Text>
                  </View>
                  <Text style={[styles.cell, { width: COL_WIDTHS[2] }]}>{e.tokenSymbol || "—"}</Text>
                  <Text style={[styles.cellNum, { width: COL_WIDTHS[3] }, amt >= 0 ? styles.pos : styles.neg]}>
                    {fmtUsd(amt)}
                  </Text>
                  <Text style={[styles.cellMono, { width: COL_WIDTHS[4] }]}>
                    {(e.counterparty || "").slice(0, 12) || "—"}
                  </Text>
                  <Text style={[styles.cellMono, { width: COL_WIDTHS[5] }]}>
                    {(e.signature || "").slice(0, 8) || "—"}
                  </Text>
                </View>
              );
            })}
            {events.length > 120 && (
              <Text style={[styles.subtitle, { marginTop: 8 }]}>
                Showing first 120 of {events.length} events. Export the full CSV for the complete dataset.
              </Text>
            )}
          </>
        )}

        <View style={styles.footer} fixed>
          <Text>Dreyv Treasury OS · dreyv.com</Text>
          <Text>Confidential — generated for {walletShort}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function GET(req: Request) {
  if (!db) return new Response("no_db", { status: 500 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const range = url.searchParams.get("range") ?? "30d";
  if (!wallet) return new Response("wallet required", { status: 400 });

  const days = RANGE_DAYS[range] ?? 30;
  const since = new Date(Date.now() - days * 86400_000);

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

  try {
    const buf = await renderToBuffer(
      <ReportDoc
        walletShort={walletShort}
        range={range}
        generatedAt={generatedAt}
        days={days}
        events={events as any[]}
        net={net}
        inflow={inflow}
        outflow={outflow}
        yieldUsd={yieldUsd}
        fee={fee}
      />
    );

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
