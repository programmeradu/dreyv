/**
 * Research Brief PDF — produced by `protocol_research_brief`.
 *
 * Sibling to the treasury report renderer. Uses the same Inter/SourceSerif
 * registration done in pdf.tsx (re-imported here so font registration runs
 * once on module load).
 */

import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import "./pdf"; // side-effect import: registers fonts

const VIOLET = "#7c3aed";
const INK = "#0b0f17";
const INK_50 = "#6b7280";
const RULE = "#e6e8ec";

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontSize: 10,
    color: INK,
    fontFamily: "Inter",
    lineHeight: 1.5,
    backgroundColor: "#ffffff",
  },
  brandRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  brandMark: { width: 8, height: 8, backgroundColor: VIOLET, marginRight: 6 },
  brand: { fontSize: 9, fontFamily: "Inter", fontWeight: 700, letterSpacing: 1.2 },
  meta: { fontSize: 7.5, color: INK_50, letterSpacing: 0.6, marginBottom: 24 },
  eyebrow: {
    fontSize: 7.5,
    color: VIOLET,
    fontFamily: "Inter",
    fontWeight: 700,
    letterSpacing: 1.6,
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontFamily: "SourceSerif",
    fontWeight: 300,
    lineHeight: 1.1,
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 8,
    fontFamily: "Inter",
    fontWeight: 700,
    letterSpacing: 1.4,
    color: INK,
    paddingBottom: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: INK,
    marginBottom: 10,
    marginTop: 18,
  },
  body: { fontSize: 10, color: INK, marginBottom: 8 },
  bullet: { flexDirection: "row", marginBottom: 6 },
  bulletDot: { width: 4, height: 4, backgroundColor: VIOLET, marginTop: 6, marginRight: 8 },
  bulletText: { fontSize: 10, color: INK, flex: 1 },
  small: { fontSize: 8, color: INK_50, marginTop: 4 },
  source: { fontSize: 8, color: INK_50, marginBottom: 3 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 56,
    right: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: INK_50,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 8,
  },
});

export interface ResearchBriefInput {
  protocol: string;
  generatedAt: string;
  walletAddress?: string | null;
  summary: string;
  insights: string[];
  suggestions: Array<{ title: string; detail: string; cta: string }>;
  sources: Array<{ url: string; source: string }>;
  rawMarkdown?: string;
}

const ResearchBriefDoc = ({ input }: { input: ResearchBriefInput }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark} />
        <Text style={styles.brand}>DREYV · RESEARCH</Text>
      </View>
      <Text style={styles.meta}>
        Generated {new Date(input.generatedAt).toUTCString()}
        {input.walletAddress ? `   ·   ${input.walletAddress.slice(0, 8)}…${input.walletAddress.slice(-4)}` : ""}
      </Text>

      <Text style={styles.eyebrow}>PROTOCOL BRIEF</Text>
      <Text style={styles.title}>{input.protocol}</Text>

      <Text style={styles.sectionHeader}>EXECUTIVE SUMMARY</Text>
      <Text style={styles.body}>{input.summary}</Text>

      {input.insights.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>KEY INSIGHTS</Text>
          {input.insights.map((it, i) => (
            <View key={i} style={styles.bullet}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{it}</Text>
            </View>
          ))}
        </>
      )}

      {input.suggestions.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>STRATEGIES FOR YOUR TREASURY</Text>
          {input.suggestions.map((s, i) => (
            <View key={i} style={{ marginBottom: 10 }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter", fontWeight: 700 }}>
                {i + 1}. {s.title}
              </Text>
              <Text style={styles.body}>{s.detail}</Text>
              <Text style={styles.small}>Suggested action: {s.cta}</Text>
            </View>
          ))}
        </>
      )}

      {input.sources.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>SOURCES</Text>
          {input.sources.slice(0, 8).map((s, i) => (
            <Text key={i} style={styles.source}>
              [{s.source}] {s.url || "—"}
            </Text>
          ))}
        </>
      )}

      <View style={styles.footer} fixed>
        <Text>Dreyv Research · prepared for the connected treasury</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </Page>
  </Document>
);

export async function renderResearchBriefPdf(input: ResearchBriefInput): Promise<Buffer> {
  return await renderToBuffer(<ResearchBriefDoc input={input} />);
}
