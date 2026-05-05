/**
 * /api/treasury/exports/report.pdf?wallet=…&range=30d
 *
 * Server-rendered Treasury Report PDF — brand-aligned (white bg, solid violet
 * accents, ambient watermark + Dreyv mark + mascot signature). No greens or
 * reds — values are in INK with subtle violet emphasis only.
 */
import React from "react";
import path from "path";
import { db } from "@/db";
import { treasuryEvents } from "@/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  Svg,
  Path,
  Circle,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

function fmtUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

const VIOLET = "#7c3aed";
const VIOLET_50 = "#f5f3ff";
const VIOLET_100 = "#ede9fe";
const VIOLET_200 = "#ddd6fe";
const VIOLET_700 = "#6d28d9";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#ede9fe";

const LOGO_PATH = path.join(process.cwd(), "public", "dreyv-mark-violet.png");
const MASCOT_PATH = path.join(process.cwd(), "public", "mascot", "dryv-greet.png");

const styles = StyleSheet.create({
  page: { padding: 36, paddingBottom: 56, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  // ── Decorative background layers (absolute) ──────────────────
  bgLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  watermarkWrap: {
    position: "absolute",
    top: 280,
    left: 0,
    right: 0,
    alignItems: "center",
    opacity: 0.08,
    transform: "rotate(-18deg)",
  },
  watermarkText: {
    fontSize: 130,
    fontWeight: 700,
    color: VIOLET,
    letterSpacing: -2,
  },
  cornerLogoWrap: {
    position: "absolute",
    bottom: 60,
    right: 32,
    opacity: 0.06,
  },
  cornerLogo: { width: 220, height: 220 },
  // ── Header ──────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 1.5,
    borderBottomColor: VIOLET,
    paddingBottom: 12,
    marginBottom: 18,
  },
  brandRow: { flexDirection: "row", alignItems: "center" },
  brandLogo: { width: 28, height: 28, marginRight: 10 },
  brandName: { fontSize: 16, fontWeight: 700, letterSpacing: -0.3, color: INK },
  brandSub: { fontSize: 8, color: MUTED, marginTop: 2 },
  meta: { fontSize: 8, color: MUTED, textAlign: "right" },
  metaStrong: { color: INK, fontWeight: 700, fontSize: 9, marginBottom: 2 },
  // ── Title ───────────────────────────────────────────────────
  h1: { fontSize: 22, fontWeight: 700, marginBottom: 3, letterSpacing: -0.4, color: INK },
  subtitle: { color: MUTED, fontSize: 9.5, marginBottom: 18 },
  // ── KPI cards ───────────────────────────────────────────────
  kpis: { flexDirection: "row", gap: 7, marginBottom: 20 },
  kpi: {
    flex: 1,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#ffffff",
  },
  kpiPrimary: { borderColor: VIOLET, backgroundColor: VIOLET_50 },
  kpiLabel: {
    fontSize: 7,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontWeight: 700,
  },
  kpiValue: { fontSize: 14, fontWeight: 700, marginTop: 4, color: INK },
  kpiAccent: { color: VIOLET_700 },
  // ── Section ─────────────────────────────────────────────────
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    marginBottom: 10,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: LINE,
    marginLeft: 8,
  },
  h2: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: VIOLET_700,
  },
  // ── Table ───────────────────────────────────────────────────
  tableHeader: {
    flexDirection: "row",
    backgroundColor: VIOLET_50,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderWidth: 1,
    borderColor: LINE,
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  th: {
    fontSize: 7,
    color: VIOLET_700,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: LINE,
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  rowAlt: { backgroundColor: "#fbfaff" },
  cell: { fontSize: 8, color: INK },
  cellMono: { fontSize: 7.5, color: MUTED, fontFamily: "Courier" },
  cellNum: { fontSize: 8, fontWeight: 700, textAlign: "right", color: INK },
  badge: {
    fontSize: 7,
    fontWeight: 700,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    backgroundColor: VIOLET_100,
    color: VIOLET_700,
    textTransform: "uppercase",
    alignSelf: "flex-start",
    borderWidth: 0.5,
    borderColor: VIOLET_200,
  },
  empty: {
    padding: 36,
    textAlign: "center",
    color: MUTED,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: VIOLET_200,
    borderRadius: 8,
    fontSize: 9.5,
    backgroundColor: "#fbfaff",
  },
  // ── Mascot signature block ──────────────────────────────────
  signature: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 8,
    padding: 12,
    backgroundColor: VIOLET_50,
  },
  mascot: { width: 56, height: 56, marginRight: 12 },
  signatureText: { flex: 1 },
  signatureName: { fontSize: 10, fontWeight: 700, color: INK },
  signatureRole: { fontSize: 8, color: MUTED, marginTop: 2 },
  signatureLine: { fontSize: 8, color: INK, marginTop: 6, lineHeight: 1.4 },
  // ── Footer ──────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 8,
    color: MUTED,
    fontSize: 7,
  },
  footerBrand: { flexDirection: "row", alignItems: "center" },
  footerLogo: { width: 10, height: 10, marginRight: 5 },
});

const COL_WIDTHS = ["18%", "14%", "12%", "20%", "18%", "18%"] as const;

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

function PageBackdrop() {
  return (
    <>
      {/* Decorative violet curves */}
      <Svg style={styles.bgLayer} viewBox="0 0 595 842">
        <Path
          d="M-50 720 Q 200 600 400 760 T 700 700 L 700 842 L -50 842 Z"
          fill={VIOLET_50}
        />
        <Circle cx="540" cy="80" r="120" fill={VIOLET_50} />
        <Circle cx="560" cy="60" r="60" fill={VIOLET_100} />
      </Svg>
      <View style={styles.watermarkWrap} fixed>
        <Text style={styles.watermarkText}>DREYV</Text>
      </View>
      <View style={styles.cornerLogoWrap} fixed>
        <Image style={styles.cornerLogo} src={LOGO_PATH} />
      </View>
    </>
  );
}

function ReportDoc(props: ReportProps) {
  const { walletShort, range, generatedAt, days, events, net, inflow, outflow, yieldUsd, fee } = props;
  const rows = events.slice(0, 120);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PageBackdrop />

        <View style={styles.header} fixed>
          <View style={styles.brandRow}>
            <Image style={styles.brandLogo} src={LOGO_PATH} />
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
          {events.length} event{events.length === 1 ? "" : "s"} captured over the last {days} day{days === 1 ? "" : "s"}.
        </Text>

        <View style={styles.kpis}>
          <View style={[styles.kpi, styles.kpiPrimary]}>
            <Text style={styles.kpiLabel}>Net</Text>
            <Text style={[styles.kpiValue, styles.kpiAccent]}>{fmtUsd(net)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Inflow</Text>
            <Text style={styles.kpiValue}>{fmtUsd(inflow)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Outflow</Text>
            <Text style={styles.kpiValue}>{fmtUsd(outflow)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Yield</Text>
            <Text style={styles.kpiValue}>{fmtUsd(yieldUsd)}</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Fees</Text>
            <Text style={styles.kpiValue}>{fmtUsd(fee)}</Text>
          </View>
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.h2}>Recent Events</Text>
          <View style={styles.sectionRule} />
        </View>

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
                <View key={i} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
                  <Text style={[styles.cellMono, { width: COL_WIDTHS[0] }]}>{when}</Text>
                  <View style={{ width: COL_WIDTHS[1] }}>
                    <Text style={styles.badge}>{kind}</Text>
                  </View>
                  <Text style={[styles.cell, { width: COL_WIDTHS[2] }]}>{e.tokenSymbol || "—"}</Text>
                  <Text style={[styles.cellNum, { width: COL_WIDTHS[3] }]}>{fmtUsd(amt)}</Text>
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
              <Text style={[styles.subtitle, { marginTop: 10 }]}>
                Showing first 120 of {events.length} events. Export the full CSV for the complete dataset.
              </Text>
            )}
          </>
        )}

        <View style={styles.signature} wrap={false}>
          <Image style={styles.mascot} src={MASCOT_PATH} />
          <View style={styles.signatureText}>
            <Text style={styles.signatureName}>Dryv</Text>
            <Text style={styles.signatureRole}>Your Treasury Co-pilot at Dreyv</Text>
            <Text style={styles.signatureLine}>
              Generated from on-chain truth — every figure traces back to a signature on Solana.
            </Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerBrand}>
            <Image style={styles.footerLogo} src={LOGO_PATH} />
            <Text>Dreyv Treasury OS · dreyv.com</Text>
          </View>
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
