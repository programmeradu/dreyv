/**
 * Phase 7A — PDF renderer using @react-pdf/renderer.
 *
 * Server-side only. Produces a Dreyv-branded treasury report PDF from
 * structured input. No client deps. Editorial / corporate aesthetic:
 * generous whitespace, hairline rules, restrained violet accents,
 * right-aligned numerics, monospaced signatures.
 */

import React from "react";
import path from "node:path";
import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    renderToBuffer,
    Font,
} from "@react-pdf/renderer";

// Register Inter (bundled OTFs, no network fetch). Inter avoids the @react-pdf
// Helvetica glyph-fragmentation bug on uppercase strings.
const FONTS_DIR = path.join(process.cwd(), "src/lib/agents/artifacts/fonts");
Font.register({
    family: "Inter",
    fonts: [
        { src: path.join(FONTS_DIR, "Inter-Regular.otf"), fontWeight: 400 },
        { src: path.join(FONTS_DIR, "Inter-Bold.otf"), fontWeight: 700 },
    ],
});
Font.registerHyphenationCallback((word) => [word]);

// ── Palette (restrained, corporate) ──────────────────────────────────
const VIOLET = "#7c3aed";
const INK = "#0b0f17";          // near-black, warmer than pure
const INK_70 = "#3a4252";
const INK_50 = "#6b7280";
const INK_30 = "#9aa1ad";
const RULE = "#e6e8ec";         // hairline
const RULE_SOFT = "#f1f2f5";
const PAGE_BG = "#ffffff";

// ── Layout tokens ────────────────────────────────────────────────────
const PAGE_MARGIN = 48;

const styles = StyleSheet.create({
    page: {
        paddingTop: PAGE_MARGIN,
        paddingBottom: PAGE_MARGIN + 12,
        paddingHorizontal: PAGE_MARGIN,
        fontSize: 9.5,
        color: INK,
        fontFamily: "Inter", fontWeight: 400,
        backgroundColor: PAGE_BG,
        lineHeight: 1.4,
    },

    // Masthead
    masthead: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        paddingBottom: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: INK,
    },
    brand: {
        fontSize: 11,
        color: INK,
        fontFamily: "Inter", fontWeight: 700,
    },
    mastheadMeta: {
        fontSize: 8,
        color: INK_50,
        textAlign: "right",

    },

    // Title block
    titleBlock: { marginTop: 28, marginBottom: 28 },
    eyebrow: {
        fontSize: 8,
        color: VIOLET,

        fontFamily: "Inter", fontWeight: 700,
        marginBottom: 10,
    },
    title: {
        fontSize: 28,
        fontFamily: "Inter", fontWeight: 400,
        color: INK,
        marginBottom: 14,
        lineHeight: 1.1,
    },
    subtitle: {
        fontSize: 9,
        color: INK_50,
        fontFamily: "Inter", fontWeight: 400,
    },

    // KPI strip
    kpiStrip: {
        flexDirection: "row",
        borderTopWidth: 0.5,
        borderTopColor: RULE,
        borderBottomWidth: 0.5,
        borderBottomColor: RULE,
        paddingVertical: 16,
        marginBottom: 28,
    },
    kpiCell: {
        flex: 1,
        paddingHorizontal: 14,
        borderLeftWidth: 0.5,
        borderLeftColor: RULE,
    },
    kpiCellFirst: { paddingHorizontal: 0, paddingRight: 14, flex: 1 },
    kpiLabel: {
        fontSize: 7,
        color: INK_50,

        marginBottom: 8,
        fontFamily: "Inter", fontWeight: 700,
    },
    kpiValue: {
        fontSize: 18,
        fontFamily: "Inter", fontWeight: 400,
        color: INK,
    },
    kpiAccent: { color: VIOLET },

    // Sections
    section: { marginBottom: 22 },
    sectionHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 10,
        paddingBottom: 6,
        borderBottomWidth: 0.5,
        borderBottomColor: INK,
    },
    sectionTitle: {
        fontSize: 11,
        fontFamily: "Inter", fontWeight: 700,
        color: INK,

    },
    sectionCount: {
        fontSize: 8,
        color: INK_50,

        fontFamily: "Inter", fontWeight: 700,
    },

    // Borderless tables
    thead: {
        flexDirection: "row",
        paddingBottom: 6,
        borderBottomWidth: 0.5,
        borderBottomColor: RULE,
    },
    th: {
        fontSize: 7,
        color: INK_50,

        fontFamily: "Inter", fontWeight: 700,
        paddingHorizontal: 6,
    },
    tr: {
        flexDirection: "row",
        paddingVertical: 8,
        borderBottomWidth: 0.5,
        borderBottomColor: RULE_SOFT,
    },
    trLast: {
        flexDirection: "row",
        paddingVertical: 8,
    },
    td: { fontSize: 9, color: INK, paddingHorizontal: 6 },
    tdMuted: { fontSize: 9, color: INK_50, paddingHorizontal: 6 },
    tdMono: { fontSize: 8.5, color: INK_70, fontFamily: "Courier", paddingHorizontal: 6 },
    right: { textAlign: "right" },

    // Status pill (text-only, no fills)
    statusBase: {
        fontSize: 7.5,

        fontFamily: "Inter", fontWeight: 700,
        paddingHorizontal: 6,
    },
    statusExecuted: { color: "#15803d" },
    statusRejected: { color: "#b91c1c" },
    statusPending: { color: "#a16207" },
    statusOther: { color: INK_50 },

    dirIn: { color: "#15803d", fontFamily: "Inter", fontWeight: 700 },
    dirOut: { color: "#b91c1c", fontFamily: "Inter", fontWeight: 700 },
    dirInternal: { color: INK_50, fontFamily: "Inter", fontWeight: 700 },

    empty: {
        fontSize: 9,
        color: INK_50,
        fontStyle: "italic",
        paddingVertical: 14,
    },

    // Footer (rendered as a fixed element on every page)
    footer: {
        position: "absolute",
        bottom: 20,
        left: PAGE_MARGIN,
        right: PAGE_MARGIN,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingTop: 8,
        borderTopWidth: 0.5,
        borderTopColor: RULE,
    },
    footerText: {
        fontSize: 7.5,
        color: INK_30,

        fontFamily: "Inter", fontWeight: 700,
    },
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
    period: string;
    generatedAt: string;
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

// ── Helpers ──────────────────────────────────────────────────────────

function fmtMoney(v: number | null | undefined, withSign = false): string {
    if (v == null) return "—";
    const sign = v < 0 ? "-" : withSign && v > 0 ? "+" : "";
    const abs = Math.abs(v).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return `${sign}$${abs}`;
}

function fmtNumber(v: number, maxFrac = 4): string {
    return v.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

function truncate(v: string | null | undefined, n = 16): string {
    if (!v) return "—";
    return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

function statusStyle(status: string) {
    const s = status.toLowerCase();
    if (s === "executed") return styles.statusExecuted;
    if (s === "rejected" || s === "vetoed" || s === "failed") return styles.statusRejected;
    if (s === "pending") return styles.statusPending;
    return styles.statusOther;
}

function dirStyle(d: "in" | "out" | "internal") {
    if (d === "in") return styles.dirIn;
    if (d === "out") return styles.dirOut;
    return styles.dirInternal;
}

function dirGlyph(d: "in" | "out" | "internal"): string {
    if (d === "in") return "+";
    if (d === "out") return "-";
    return "~";
}

function fmtPeriod(p: string): string {
    // "2026-03" → "March 2026"
    const m = /^(\d{4})-(\d{2})$/.exec(p);
    if (!m) return p;
    const [, y, mo] = m;
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const idx = parseInt(mo, 10) - 1;
    if (idx < 0 || idx > 11) return p;
    return `${months[idx]} ${y}`;
}

function fmtGenerated(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleString("en-US", {
            year: "numeric", month: "short", day: "2-digit",
            hour: "2-digit", minute: "2-digit",
            timeZone: "UTC", timeZoneName: "short",
        });
    } catch {
        return iso;
    }
}

// Column widths (in flex units) — tuned for A4 minus 96pt margins.
const PROPOSAL_COLS = {
    date: 1.1, title: 3.2, type: 1.0, status: 1.2, quorum: 0.7, value: 1.2,
};
const TX_COLS = {
    date: 1.1, dir: 0.4, token: 0.8, amount: 1.4, value: 1.3, counterparty: 1.6, sig: 1.6,
};
const POLICY_COLS = {
    date: 1.1, capability: 1.8, decision: 1.6, risk: 0.7, notes: 3.0,
};

// ── Renderer ─────────────────────────────────────────────────────────

function ReportDoc({ input }: { input: TreasuryReportInput }) {
    const { summary, proposals, transactions, policyActions } = input;
    const periodLabel = fmtPeriod(input.period);
    const netSigned = summary.netFlowUsd;

    return (
        <Document
            title={`Dreyv Treasury Report — ${periodLabel}`}
            author="Dreyv"
            creator="Dreyv Agents"
            producer="@react-pdf/renderer"
        >
            <Page size="A4" style={styles.page}>
                {/* Masthead */}
                <View style={styles.masthead} fixed>
                    <Text style={styles.brand}>DREYV</Text>
                    <View>
                        <Text style={styles.mastheadMeta}>TREASURY REPORT</Text>
                        <Text style={styles.mastheadMeta}>{fmtGenerated(input.generatedAt)}</Text>
                    </View>
                </View>

                {/* Title */}
                <View style={styles.titleBlock}>
                    <Text style={styles.eyebrow}>REPORTING PERIOD</Text>
                    <Text style={styles.title}>{periodLabel}</Text>
                    <Text style={styles.subtitle}>{input.walletOrVault}</Text>
                </View>

                {/* KPI strip */}
                <View style={styles.kpiStrip}>
                    <View style={styles.kpiCellFirst}>
                        <Text style={styles.kpiLabel}>NET FLOW</Text>
                        <Text style={[styles.kpiValue, netSigned != null && netSigned < 0 ? { color: "#b91c1c" } : netSigned != null && netSigned > 0 ? { color: "#15803d" } : {}]}>
                            {fmtMoney(netSigned, true)}
                        </Text>
                    </View>
                    <View style={styles.kpiCell}>
                        <Text style={styles.kpiLabel}>TRANSACTIONS</Text>
                        <Text style={styles.kpiValue}>{summary.totalTransactions}</Text>
                    </View>
                    <View style={styles.kpiCell}>
                        <Text style={styles.kpiLabel}>PROPOSALS</Text>
                        <Text style={styles.kpiValue}>
                            {summary.executedProposals}
                            <Text style={{ color: INK_30 }}> / {summary.totalProposals}</Text>
                        </Text>
                    </View>
                    <View style={styles.kpiCell}>
                        <Text style={styles.kpiLabel}>ENDING BALANCE</Text>
                        <Text style={[styles.kpiValue, styles.kpiAccent]}>
                            {summary.endingBalanceUsd != null ? fmtMoney(summary.endingBalanceUsd) : "—"}
                        </Text>
                    </View>
                </View>

                {/* Proposals */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>PROPOSALS</Text>
                        <Text style={styles.sectionCount}>{proposals.length} TOTAL</Text>
                    </View>
                    {proposals.length === 0 ? (
                        <Text style={styles.empty}>No proposals in this period.</Text>
                    ) : (
                        <View>
                            <View style={styles.thead}>
                                <Text style={[styles.th, { flex: PROPOSAL_COLS.date }]}>DATE</Text>
                                <Text style={[styles.th, { flex: PROPOSAL_COLS.title }]}>TITLE</Text>
                                <Text style={[styles.th, { flex: PROPOSAL_COLS.type }]}>TYPE</Text>
                                <Text style={[styles.th, { flex: PROPOSAL_COLS.status }]}>STATUS</Text>
                                <Text style={[styles.th, { flex: PROPOSAL_COLS.quorum }]}>QUORUM</Text>
                                <Text style={[styles.th, styles.right, { flex: PROPOSAL_COLS.value }]}>VALUE</Text>
                            </View>
                            {proposals.map((p, i) => (
                                <View key={i} style={i === proposals.length - 1 ? styles.trLast : styles.tr}>
                                    <Text style={[styles.tdMuted, { flex: PROPOSAL_COLS.date }]}>{p.date}</Text>
                                    <Text style={[styles.td, { flex: PROPOSAL_COLS.title }]}>{p.title}</Text>
                                    <Text style={[styles.tdMuted, { flex: PROPOSAL_COLS.type }]}>{p.type}</Text>
                                    <Text style={[styles.statusBase, statusStyle(p.status), { flex: PROPOSAL_COLS.status }]}>
                                        {p.status.toUpperCase()}
                                    </Text>
                                    <Text style={[styles.tdMuted, { flex: PROPOSAL_COLS.quorum }]}>{p.quorum ?? "—"}</Text>
                                    <Text style={[styles.td, styles.right, { flex: PROPOSAL_COLS.value }]}>
                                        {fmtMoney(p.valueUsd ?? null)}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                {/* Transactions */}
                <View style={styles.section} wrap>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>TRANSACTIONS</Text>
                        <Text style={styles.sectionCount}>{transactions.length} TOTAL</Text>
                    </View>
                    {transactions.length === 0 ? (
                        <Text style={styles.empty}>No transactions in this period.</Text>
                    ) : (
                        <View>
                            <View style={styles.thead} fixed>
                                <Text style={[styles.th, { flex: TX_COLS.date }]}>DATE</Text>
                                <Text style={[styles.th, { flex: TX_COLS.dir }]}> </Text>
                                <Text style={[styles.th, { flex: TX_COLS.token }]}>TOKEN</Text>
                                <Text style={[styles.th, styles.right, { flex: TX_COLS.amount }]}>AMOUNT</Text>
                                <Text style={[styles.th, styles.right, { flex: TX_COLS.value }]}>VALUE</Text>
                                <Text style={[styles.th, { flex: TX_COLS.counterparty }]}>COUNTERPARTY</Text>
                                <Text style={[styles.th, { flex: TX_COLS.sig }]}>SIGNATURE</Text>
                            </View>
                            {transactions.map((t, i) => (
                                <View key={i} style={i === transactions.length - 1 ? styles.trLast : styles.tr} wrap={false}>
                                    <Text style={[styles.tdMuted, { flex: TX_COLS.date }]}>{t.date}</Text>
                                    <Text style={[dirStyle(t.direction), { flex: TX_COLS.dir, fontSize: 11 }]}>
                                        {dirGlyph(t.direction)}
                                    </Text>
                                    <Text style={[styles.td, { flex: TX_COLS.token }]}>{t.token}</Text>
                                    <Text style={[styles.td, styles.right, { flex: TX_COLS.amount }]}>
                                        {fmtNumber(t.amount)}
                                    </Text>
                                    <Text style={[styles.td, styles.right, { flex: TX_COLS.value }]}>
                                        {fmtMoney(t.valueUsd ?? null)}
                                    </Text>
                                    <Text style={[styles.tdMuted, { flex: TX_COLS.counterparty }]}>
                                        {truncate(t.counterparty, 16)}
                                    </Text>
                                    <Text style={[styles.tdMono, { flex: TX_COLS.sig }]}>
                                        {truncate(t.signature, 14)}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                {/* Policy actions */}
                {policyActions && policyActions.length > 0 ? (
                    <View style={styles.section} wrap>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>POLICY ACTIONS</Text>
                            <Text style={styles.sectionCount}>{policyActions.length} TOTAL</Text>
                        </View>
                        <View>
                            <View style={styles.thead}>
                                <Text style={[styles.th, { flex: POLICY_COLS.date }]}>DATE</Text>
                                <Text style={[styles.th, { flex: POLICY_COLS.capability }]}>CAPABILITY</Text>
                                <Text style={[styles.th, { flex: POLICY_COLS.decision }]}>DECISION</Text>
                                <Text style={[styles.th, styles.right, { flex: POLICY_COLS.risk }]}>RISK</Text>
                                <Text style={[styles.th, { flex: POLICY_COLS.notes }]}>NOTES</Text>
                            </View>
                            {policyActions.map((a, i) => (
                                <View key={i} style={i === policyActions.length - 1 ? styles.trLast : styles.tr} wrap={false}>
                                    <Text style={[styles.tdMuted, { flex: POLICY_COLS.date }]}>{a.date}</Text>
                                    <Text style={[styles.tdMono, { flex: POLICY_COLS.capability }]}>{a.capability}</Text>
                                    <Text style={[styles.td, { flex: POLICY_COLS.decision }]}>{a.decision}</Text>
                                    <Text style={[styles.td, styles.right, { flex: POLICY_COLS.risk }]}>
                                        {a.riskScore ?? "—"}
                                    </Text>
                                    <Text style={[styles.tdMuted, { flex: POLICY_COLS.notes }]}>{a.notes ?? ""}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                ) : null}

                {/* Footer */}
                <View style={styles.footer} fixed>
                    <Text style={styles.footerText}>DREYV / TREASURY OS</Text>
                    <Text
                        style={styles.footerText}
                        render={({ pageNumber, totalPages }) =>
                            `PAGE ${pageNumber} OF ${totalPages}`
                        }
                    />
                </View>
            </Page>
        </Document>
    );
}

export async function renderTreasuryReportPdf(input: TreasuryReportInput): Promise<Buffer> {
    return await renderToBuffer(<ReportDoc input={input} />);
}
