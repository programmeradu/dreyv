import React from "react";
import path from "path";
import { Document, Page, Text, View, Image, Svg, Path, Circle, StyleSheet, renderToFile } from "@react-pdf/renderer";

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

// Inline minimal copy of ReportDoc for QA

const events: any[] = [
  { occurredAt: new Date(), kind: "inflow", tokenSymbol: "USDC", amountUsd: 5000, counterparty: "8gKa...x9Pq", signature: "5jHy7Kpo" },
  { occurredAt: new Date(), kind: "outflow", tokenSymbol: "SOL", amountUsd: -1200, counterparty: "Ax12...zZ44", signature: "9pQr3Lwe" },
  { occurredAt: new Date(), kind: "yield", tokenSymbol: "mSOL", amountUsd: 84.55, counterparty: "Mar1...nde9", signature: "2Lkj8Ttx" },
  { occurredAt: new Date(), kind: "fee", tokenSymbol: "SOL", amountUsd: -1.20, counterparty: "—", signature: "0xFee123" },
];

const styles = StyleSheet.create({
  page: { padding: 36, paddingBottom: 56, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  bgLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  watermarkWrap: { position: "absolute", top: 220, left: 0, right: 0, alignItems: "center", opacity: 0.05 },
  watermarkText: { fontSize: 130, fontWeight: 700, color: VIOLET, letterSpacing: -2 },
  cornerLogoWrap: { position: "absolute", bottom: 60, right: 32, opacity: 0.06 },
  cornerLogo: { width: 220, height: 220 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 1.5, borderBottomColor: VIOLET, paddingBottom: 12, marginBottom: 18 },
  brandRow: { flexDirection: "row", alignItems: "center" },
  brandLogo: { width: 28, height: 28, marginRight: 10 },
  brandName: { fontSize: 16, fontWeight: 700, letterSpacing: -0.3, color: INK },
  brandSub: { fontSize: 8, color: MUTED, marginTop: 2 },
  meta: { fontSize: 8, color: MUTED, textAlign: "right" },
  metaStrong: { color: INK, fontWeight: 700, fontSize: 9, marginBottom: 2 },
  h1: { fontSize: 22, fontWeight: 700, marginBottom: 3, letterSpacing: -0.4, color: INK },
  subtitle: { color: MUTED, fontSize: 9.5, marginBottom: 18 },
  kpis: { flexDirection: "row", gap: 7, marginBottom: 20 },
  kpi: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 10, backgroundColor: "#ffffff" },
  kpiPrimary: { borderColor: VIOLET, backgroundColor: VIOLET_50 },
  kpiLabel: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 },
  kpiValue: { fontSize: 14, fontWeight: 700, marginTop: 4, color: INK },
  kpiAccent: { color: VIOLET_700 },
  sectionHead: { flexDirection: "row", alignItems: "center", marginTop: 6, marginBottom: 10 },
  sectionRule: { flex: 1, height: 1, backgroundColor: LINE, marginLeft: 8 },
  h2: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: VIOLET_700 },
  tableHeader: { flexDirection: "row", backgroundColor: VIOLET_50, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderWidth: 1, borderColor: LINE, paddingVertical: 7, paddingHorizontal: 6 },
  th: { fontSize: 7, color: VIOLET_700, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderLeftWidth: 1, borderRightWidth: 1, borderColor: LINE, paddingVertical: 6, paddingHorizontal: 6, alignItems: "center" },
  rowAlt: { backgroundColor: "#fbfaff" },
  cell: { fontSize: 8, color: INK },
  cellMono: { fontSize: 7.5, color: MUTED, fontFamily: "Courier" },
  cellNum: { fontSize: 8, fontWeight: 700, textAlign: "right", color: INK },
  badge: { fontSize: 7, fontWeight: 700, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3, backgroundColor: VIOLET_100, color: VIOLET_700, textTransform: "uppercase", alignSelf: "flex-start", borderWidth: 0.5, borderColor: VIOLET_200 },
  signature: { marginTop: 22, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 12, backgroundColor: VIOLET_50 },
  mascot: { width: 56, height: 56, marginRight: 12 },
  signatureText: { flex: 1 },
  signatureName: { fontSize: 10, fontWeight: 700, color: INK },
  signatureRole: { fontSize: 8, color: MUTED, marginTop: 2 },
  signatureLine: { fontSize: 8, color: INK, marginTop: 6, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, color: MUTED, fontSize: 7 },
  footerBrand: { flexDirection: "row", alignItems: "center" },
  footerLogo: { width: 10, height: 10, marginRight: 5 },
});
const COL_WIDTHS = ["18%", "14%", "12%", "20%", "18%", "18%"];

const Doc = (
  <Document>
    <Page size="A4" style={styles.page}>
      <Svg style={styles.bgLayer} viewBox="0 0 595 842">
        <Path d="M-50 720 Q 200 600 400 760 T 700 700 L 700 842 L -50 842 Z" fill={VIOLET_50} />
        <Circle cx="540" cy="80" r="120" fill={VIOLET_50} />
        <Circle cx="560" cy="60" r="60" fill={VIOLET_100} />
      </Svg>
      <View style={styles.watermarkWrap} fixed><Text style={styles.watermarkText}>DREYV</Text></View>
      <View style={styles.cornerLogoWrap} fixed><Image style={styles.cornerLogo} src={LOGO_PATH} /></View>

      <View style={styles.header} fixed>
        <View style={styles.brandRow}>
          <Image style={styles.brandLogo} src={LOGO_PATH} />
          <View><Text style={styles.brandName}>Dreyv</Text><Text style={styles.brandSub}>Treasury OS · Report</Text></View>
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaStrong}>9agsk4…Yn8n</Text>
          <Text>Range: 30d · Generated 2026-05-05 03:52 UTC</Text>
        </View>
      </View>

      <Text style={styles.h1}>Treasury Report</Text>
      <Text style={styles.subtitle}>{events.length} events captured over the last 30 days.</Text>

      <View style={styles.kpis}>
        <View style={[styles.kpi, styles.kpiPrimary]}><Text style={styles.kpiLabel}>Net</Text><Text style={[styles.kpiValue, styles.kpiAccent]}>$3,883.35</Text></View>
        <View style={styles.kpi}><Text style={styles.kpiLabel}>Inflow</Text><Text style={styles.kpiValue}>$5,000.00</Text></View>
        <View style={styles.kpi}><Text style={styles.kpiLabel}>Outflow</Text><Text style={styles.kpiValue}>-$1,200.00</Text></View>
        <View style={styles.kpi}><Text style={styles.kpiLabel}>Yield</Text><Text style={styles.kpiValue}>$84.55</Text></View>
        <View style={styles.kpi}><Text style={styles.kpiLabel}>Fees</Text><Text style={styles.kpiValue}>-$1.20</Text></View>
      </View>

      <View style={styles.sectionHead}><Text style={styles.h2}>Recent Events</Text><View style={styles.sectionRule} /></View>

      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: COL_WIDTHS[0] }]}>When (UTC)</Text>
        <Text style={[styles.th, { width: COL_WIDTHS[1] }]}>Kind</Text>
        <Text style={[styles.th, { width: COL_WIDTHS[2] }]}>Token</Text>
        <Text style={[styles.th, { width: COL_WIDTHS[3], textAlign: "right" }]}>Amount (USD)</Text>
        <Text style={[styles.th, { width: COL_WIDTHS[4] }]}>Counterparty</Text>
        <Text style={[styles.th, { width: COL_WIDTHS[5] }]}>Signature</Text>
      </View>
      {events.map((e, i) => (
        <View key={i} style={[styles.row, i % 2 === 1 ? styles.rowAlt : {}]} wrap={false}>
          <Text style={[styles.cellMono, { width: COL_WIDTHS[0] }]}>{new Date(e.occurredAt).toISOString().slice(0,16).replace("T"," ")}</Text>
          <View style={{ width: COL_WIDTHS[1] }}><Text style={styles.badge}>{e.kind}</Text></View>
          <Text style={[styles.cell, { width: COL_WIDTHS[2] }]}>{e.tokenSymbol}</Text>
          <Text style={[styles.cellNum, { width: COL_WIDTHS[3] }]}>${e.amountUsd.toFixed(2)}</Text>
          <Text style={[styles.cellMono, { width: COL_WIDTHS[4] }]}>{e.counterparty}</Text>
          <Text style={[styles.cellMono, { width: COL_WIDTHS[5] }]}>{e.signature}</Text>
        </View>
      ))}

      <View style={styles.signature} wrap={false}>
        <Image style={styles.mascot} src={MASCOT_PATH} />
        <View style={styles.signatureText}>
          <Text style={styles.signatureName}>Dryv</Text>
          <Text style={styles.signatureRole}>Your Treasury Co-pilot at Dreyv</Text>
          <Text style={styles.signatureLine}>Generated from on-chain truth — every figure traces back to a signature on Solana.</Text>
        </View>
      </View>

      <View style={styles.footer} fixed>
        <View style={styles.footerBrand}>
          <Image style={styles.footerLogo} src={LOGO_PATH} />
          <Text>Dreyv Treasury OS · dreyv.com</Text>
        </View>
        <Text>Confidential — generated for 9agsk4…Yn8n</Text>
      </View>
    </Page>
  </Document>
);

renderToFile(Doc, "/tmp/qa-out.pdf");
renderToFile(Doc, "/tmp/qa-out.pdf").then(() => console.log("ok")).catch(e => { console.error(e); process.exit(1); });
