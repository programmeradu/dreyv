/**
 * Phase 7A — PDF renderer using @react-pdf/renderer.
 *
 * Server-side only. Produces a Dreyv-branded treasury report PDF from
 * structured input. No client deps.
 */

import React from "react";
import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    renderToBuffer,
    Font,
} from "@react-pdf/renderer";

// Use @react-pdf built-in fonts (Helvetica/Times/Courier are bundled — no
// network fetch). Avoid Manrope here to keep PDF generation hermetic.
Font.registerHyphenationCallback((word) => [word]);

const VIOLET = "#7c3aed";
const VIOLET_LIGHT = "#ede9fe";
const SLATE = "#0f172a";
const SLATE_500 = "#64748b";
const SLATE_200 = "#e2e8f0";

const styles = StyleSheet.create({
    page: { padding: 36, fontSize: 10, color: SLATE, fontFamily: "Helvetica" },
    headerBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 },
    brand: { fontSize: 18, color: VIOLET, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
    headerMeta: { fontSize: 9, color: SLATE_500, textAlign: "right" },
    title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginBottom: 4 },
    subtitle: { fontSize: 11, color: SLATE_500, marginBottom: 18 },
    sectionTitle: {
        fontSize: 12,
        fontFamily: "Helvetica-Bold",
        color: VIOLET,
        marginTop: 14,
        marginBottom: 6,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    summaryGrid: { flexDirection: "row", gap: 8, marginBottom: 8 },
    summaryCard: {
        flex: 1,
        backgroundColor: VIOLET_LIGHT,
        borderRadius: 6,
        padding: 10,
    },
    summaryLabel: { fontSize: 8, color: SLATE_500, textTransform: "uppercase", letterSpacing: 0.6 },
    summaryValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: SLATE, marginTop: 4 },
    table: { borderWidth: 1, borderColor: SLATE_200, borderRadius: 4, marginTop: 4 },
    tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: SLATE_200 },
    trLast: { flexDirection: "row" },
    th: {
        flex: 1, padding: 6, fontFamily: "Helvetica-Bold", fontSize: 9,
        backgroundColor: VIOLET_LIGHT, color: SLATE,
    },
    td: { flex: 1, padding: 6, fontSize: 9, color: SLATE },
    tdMuted: { flex: 1, padding: 6, fontSize: 9, color: SLATE_500 },
    pageNumber: {
        position: "absolute", bottom: 18, left: 36, right: 36,
        fontSize: 8, color: SLATE_500, textAlign: "center",
    },
    empty: { fontSize: 10, color: SLATE_500, fontStyle: "italic", padding: 12, textAlign: "center" },
});

// ── Public input schema ──────────────────────────────────────────────

export interface ProposalRow {
    date: string;
    title: string;
    type: string;
    status: string;
    quorum?: string;
    valueUsd?: number | null;
    signature?: string | null;
}

export interface TransactionRow {
    date: string;
    signature: string;
    direction: "in" | "out" | "internal";
    token: string;
    amount: number;
    valueUsd?: number | null;
    counterparty?: string | null;
}

export interface PolicyActionRow {
    date: string;
    capability: string;
    decision: string;
    riskScore?: number | null;
    notes?: string | null;
}

export interface TreasuryReportInput {
    walletOrVault: string;
    period: string;                 // e.g. "April 2026" or "2026-04-01 → 2026-04-30"
    generatedAt: string;            // ISO
    summary: {
        totalProposals: number;
        executedProposals: number;
        totalTransactions: number;
        netFlowUsd: number | null;
        startingBalanceUsd?: number | null;
        endingBalanceUsd?: number | null;
    };
    proposals: ProposalRow[];
    transactions: TransactionRow[];
    policyActions?: PolicyActionRow[];
}

// ── Renderer ─────────────────────────────────────────────────────────

function Money({ v }: { v: number | null | undefined }) {
    if (v == null) return <Text>—</Text>;
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
    return <Text>{`${sign}$${abs}`}</Text>;
}

function Truncate({ v, n = 18 }: { v: string; n?: number }) {
    if (!v) return <Text>—</Text>;
    return <Text>{v.length > n ? `${v.slice(0, n - 3)}...` : v}</Text>;
}

function ReportDoc({ input }: { input: TreasuryReportInput }) {
    const { summary, proposals, transactions, policyActions } = input;

    return (
        <Document
            title={`Dreyv Treasury Report — ${input.period}`}
            author="Dreyv"
            creator="Dreyv Agents"
            producer="@react-pdf/renderer"
        >
            <Page size="A4" style={styles.page}>
                <View style={styles.headerBar}>
                    <Text style={styles.brand}>DREYV</Text>
                    <Text style={styles.headerMeta}>
                        {`Treasury report\nGenerated ${new Date(input.generatedAt).toUTCString()}`}
                    </Text>
                </View>

                <Text style={styles.title}>Treasury Report — {input.period}</Text>
                <Text style={styles.subtitle}>{input.walletOrVault}</Text>

                <View style={styles.summaryGrid}>
                    <View style={styles.summaryCard}>
                        <Text style={styles.summaryLabel}>Proposals</Text>
                        <Text style={styles.summaryValue}>{summary.totalProposals}</Text>
                    </View>
                    <View style={styles.summaryCard}>
                        <Text style={styles.summaryLabel}>Executed</Text>
                        <Text style={styles.summaryValue}>{summary.executedProposals}</Text>
                    </View>
                    <View style={styles.summaryCard}>
                        <Text style={styles.summaryLabel}>Transactions</Text>
                        <Text style={styles.summaryValue}>{summary.totalTransactions}</Text>
                    </View>
                    <View style={styles.summaryCard}>
                        <Text style={styles.summaryLabel}>Net flow (USD)</Text>
                        <Text style={styles.summaryValue}>
                            <Money v={summary.netFlowUsd} />
                        </Text>
                    </View>
                </View>

                {/* Proposals */}
                <Text style={styles.sectionTitle}>Proposals ({proposals.length})</Text>
                {proposals.length === 0 ? (
                    <Text style={styles.empty}>No proposals in this period.</Text>
                ) : (
                    <View style={styles.table}>
                        <View style={styles.tr}>
                            <Text style={styles.th}>Date</Text>
                            <Text style={styles.th}>Title</Text>
                            <Text style={styles.th}>Type</Text>
                            <Text style={styles.th}>Status</Text>
                            <Text style={styles.th}>Quorum</Text>
                            <Text style={styles.th}>USD</Text>
                        </View>
                        {proposals.map((p, i) => (
                            <View key={i} style={i === proposals.length - 1 ? styles.trLast : styles.tr}>
                                <Text style={styles.td}>{p.date}</Text>
                                <Text style={styles.td}>{p.title}</Text>
                                <Text style={styles.td}>{p.type}</Text>
                                <Text style={styles.td}>{p.status}</Text>
                                <Text style={styles.tdMuted}>{p.quorum ?? "—"}</Text>
                                <Text style={styles.td}><Money v={p.valueUsd ?? null} /></Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* Transactions */}
                <Text style={styles.sectionTitle}>Transactions ({transactions.length})</Text>
                {transactions.length === 0 ? (
                    <Text style={styles.empty}>No transactions in this period.</Text>
                ) : (
                    <View style={styles.table}>
                        <View style={styles.tr}>
                            <Text style={styles.th}>Date</Text>
                            <Text style={styles.th}>Sig</Text>
                            <Text style={styles.th}>Dir</Text>
                            <Text style={styles.th}>Token</Text>
                            <Text style={styles.th}>Amount</Text>
                            <Text style={styles.th}>USD</Text>
                            <Text style={styles.th}>Counterparty</Text>
                        </View>
                        {transactions.map((t, i) => (
                            <View key={i} style={i === transactions.length - 1 ? styles.trLast : styles.tr}>
                                <Text style={styles.td}>{t.date}</Text>
                                <Text style={styles.td}><Truncate v={t.signature} n={14} /></Text>
                                <Text style={styles.td}>{t.direction}</Text>
                                <Text style={styles.td}>{t.token}</Text>
                                <Text style={styles.td}>
                                    {t.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                                </Text>
                                <Text style={styles.td}><Money v={t.valueUsd ?? null} /></Text>
                                <Text style={styles.tdMuted}><Truncate v={t.counterparty ?? "—"} n={14} /></Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* Policy actions */}
                {policyActions && policyActions.length > 0 ? (
                    <>
                        <Text style={styles.sectionTitle}>Policy actions ({policyActions.length})</Text>
                        <View style={styles.table}>
                            <View style={styles.tr}>
                                <Text style={styles.th}>Date</Text>
                                <Text style={styles.th}>Capability</Text>
                                <Text style={styles.th}>Decision</Text>
                                <Text style={styles.th}>Risk</Text>
                                <Text style={styles.th}>Notes</Text>
                            </View>
                            {policyActions.map((a, i) => (
                                <View key={i} style={i === policyActions.length - 1 ? styles.trLast : styles.tr}>
                                    <Text style={styles.td}>{a.date}</Text>
                                    <Text style={styles.td}>{a.capability}</Text>
                                    <Text style={styles.td}>{a.decision}</Text>
                                    <Text style={styles.tdMuted}>{a.riskScore ?? "—"}</Text>
                                    <Text style={styles.tdMuted}>{a.notes ?? ""}</Text>
                                </View>
                            ))}
                        </View>
                    </>
                ) : null}

                <Text
                    style={styles.pageNumber}
                    render={({ pageNumber, totalPages }) =>
                        `Dreyv • ${input.walletOrVault} • Page ${pageNumber} / ${totalPages}`
                    }
                    fixed
                />
            </Page>
        </Document>
    );
}

export async function renderTreasuryReportPdf(input: TreasuryReportInput): Promise<Buffer> {
    return await renderToBuffer(<ReportDoc input={input} />);
}
