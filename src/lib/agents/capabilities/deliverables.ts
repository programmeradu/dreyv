/**
 * Phase 7A — Deliverables capabilities.
 *
 * Three new intel-domain capabilities that produce real downloadable artifacts
 * (PDF, CSV, ZIP audit pack) from real on-chain + DB data, then upload them to
 * the `treasury-artifacts` Supabase Storage bucket and return signed URLs.
 *
 *   - treasury_report_pdf  — month-scoped PDF report
 *   - treasury_report_csv  — month-scoped CSV (proposals + transactions sheets concatenated)
 *   - audit_pack_generate  — ZIP bundle: PDF + CSVs + raw JSON
 *
 * No stubs. Throws hard when HELIUS_API_KEY or Supabase service role are
 * missing. Logs to `agent_episodes` so the artifact is searchable later.
 */

import { z } from "zod";
import JSZip from "jszip";
import { defineCapability, type AnyCapability } from "./types";
import { renderTreasuryReportPdf } from "../artifacts/pdf";
import { buildCsv } from "../artifacts/csv";
import { uploadArtifact, type UploadedArtifact } from "../artifacts/storage";
import { buildTreasuryReportData } from "../artifacts/build-report";
import { db } from "@/db";
import { agentEpisodes } from "@/db/schema";

const monthSchema = z
    .string()
    .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM");

async function logEpisode(opts: {
    capabilityId: string;
    walletAddress: string | null;
    outcome: "produced" | "failed";
    notes: string;
    artifact?: UploadedArtifact;
}) {
    try {
        if (!db) return;
        await db.insert(agentEpisodes).values({
            commandId: `artifact-${Date.now()}`,
            walletAddress: opts.walletAddress,
            intentKind: "deliverable",
            capabilityIds: [opts.capabilityId],
            outcome: opts.outcome,
            notes: opts.artifact
                ? `${opts.notes} | artifact=${opts.artifact.kind}:${opts.artifact.path}`
                : opts.notes,
        });
    } catch {
        // Episode logging must never break a real deliverable; surface to logs only.
        console.warn(`[${opts.capabilityId}] episode log failed (non-fatal)`);
    }
}

// ── treasury_report_pdf ──────────────────────────────────────────────

const treasury_report_pdf = defineCapability({
    id: "treasury_report_pdf",
    domain: "intel",
    description:
        "Generate a downloadable PDF treasury report (proposals + transactions + policy actions) for a given month. Returns a signed URL to the PDF.",
    inputSchema: z.object({
        month: monthSchema.describe("Month to report on, format YYYY-MM, e.g. 2026-04"),
        walletOrVault: z
            .string()
            .optional()
            .describe("Override wallet/vault PDA. Defaults to ctx.walletAddress."),
        solPriceUsd: z.number().optional().describe("Optional spot SOL price for USD valuation."),
    }),
    sideEffects: "read",
    requiredAuth: "wallet",
    sensitivity: "low",
    execute: async (input, ctx) => {
        const target = input.walletOrVault ?? ctx.walletAddress;
        if (!target) throw new Error("treasury_report_pdf: no wallet/vault provided");

        const data = await buildTreasuryReportData({
            walletOrVault: target,
            month: input.month,
            userId: null,
            solPriceUsd: input.solPriceUsd ?? null,
        });

        const pdf = await renderTreasuryReportPdf(data);
        const artifact = await uploadArtifact({
            body: pdf,
            filename: `dreyv-treasury-${target.slice(0, 8)}-${input.month}.pdf`,
            mime: "application/pdf",
            kind: "pdf",
            ownerKey: target,
            folder: `reports/${input.month}`,
            capabilityId: "treasury_report_pdf",
            commandId: ctx.commandId ?? null,
            meta: { month: input.month, wallet: target },
        });

        await logEpisode({
            capabilityId: "treasury_report_pdf",
            walletAddress: target,
            outcome: "produced",
            notes: `period=${input.month} txs=${data.transactions.length} proposals=${data.proposals.length}`,
            artifact,
        });

        return {
            success: true,
            operation: "treasury_report_pdf",
            status: "completed" as const,
            period: data.period,
            wallet: target,
            summary: data.summary,
            artifacts: [artifact],
            message: `PDF report ready (${data.transactions.length} txs, ${data.proposals.length} proposals).`,
        };
    },
});

// ── treasury_report_csv ──────────────────────────────────────────────

const treasury_report_csv = defineCapability({
    id: "treasury_report_csv",
    domain: "intel",
    description:
        "Generate a CSV export of proposals + transactions for a given month. Spreadsheet-friendly (Excel, TokenTax, Cryptio).",
    inputSchema: z.object({
        month: monthSchema,
        walletOrVault: z.string().optional(),
        sheet: z.enum(["transactions", "proposals", "both"]).optional().default("both"),
    }),
    sideEffects: "read",
    requiredAuth: "wallet",
    sensitivity: "low",
    execute: async (input, ctx) => {
        const target = input.walletOrVault ?? ctx.walletAddress;
        if (!target) throw new Error("treasury_report_csv: no wallet/vault provided");

        const data = await buildTreasuryReportData({
            walletOrVault: target,
            month: input.month,
            userId: null,
        });

        const sheets: Buffer[] = [];
        const preamble = [`Dreyv treasury export — ${data.period}`, `wallet=${target}`];

        if (input.sheet === "transactions" || input.sheet === "both") {
            sheets.push(
                buildCsv({
                    rows: data.transactions,
                    columns: ["date", "signature", "direction", "token", "amount", "valueUsd", "counterparty"],
                    preamble: [...preamble, "sheet=transactions"],
                }),
            );
        }
        if (input.sheet === "proposals" || input.sheet === "both") {
            sheets.push(
                buildCsv({
                    rows: data.proposals,
                    columns: ["date", "title", "type", "status", "quorum", "valueUsd", "signature"],
                    preamble: [...preamble, "sheet=proposals"],
                }),
            );
        }

        const body = Buffer.concat(sheets.flatMap((s, i) => (i > 0 ? [Buffer.from("\n\n"), s] : [s])));

        const artifact = await uploadArtifact({
            body,
            filename: `dreyv-treasury-${target.slice(0, 8)}-${input.month}.csv`,
            mime: "text/csv",
            kind: "csv",
            ownerKey: target,
            folder: `reports/${input.month}`,
        });

        await logEpisode({
            capabilityId: "treasury_report_csv",
            walletAddress: target,
            outcome: "produced",
            notes: `period=${input.month} sheet=${input.sheet}`,
            artifact,
        });

        return {
            success: true,
            operation: "treasury_report_csv",
            status: "completed" as const,
            period: data.period,
            wallet: target,
            artifacts: [artifact],
            message: `CSV export ready (${data.transactions.length} txs, ${data.proposals.length} proposals).`,
        };
    },
});

// ── audit_pack_generate ──────────────────────────────────────────────

const audit_pack_generate = defineCapability({
    id: "audit_pack_generate",
    domain: "intel",
    description:
        "Generate a ZIP audit pack for a given month: PDF report + transactions CSV + proposals CSV + raw JSON. Returns one signed download URL.",
    inputSchema: z.object({
        month: monthSchema,
        walletOrVault: z.string().optional(),
    }),
    sideEffects: "read",
    requiredAuth: "wallet",
    sensitivity: "low",
    execute: async (input, ctx) => {
        const target = input.walletOrVault ?? ctx.walletAddress;
        if (!target) throw new Error("audit_pack_generate: no wallet/vault provided");

        const data = await buildTreasuryReportData({
            walletOrVault: target,
            month: input.month,
            userId: null,
        });

        const pdf = await renderTreasuryReportPdf(data);
        const txCsv = buildCsv({
            rows: data.transactions,
            columns: ["date", "signature", "direction", "token", "amount", "valueUsd", "counterparty"],
            preamble: [`Dreyv treasury export — ${data.period}`, `wallet=${target}`, "sheet=transactions"],
        });
        const propCsv = buildCsv({
            rows: data.proposals,
            columns: ["date", "title", "type", "status", "quorum", "valueUsd", "signature"],
            preamble: [`Dreyv treasury export — ${data.period}`, `wallet=${target}`, "sheet=proposals"],
        });

        const zip = new JSZip();
        zip.file("report.pdf", pdf);
        zip.file("transactions.csv", txCsv);
        zip.file("proposals.csv", propCsv);
        zip.file("raw.json", JSON.stringify(data, null, 2));
        zip.file(
            "README.txt",
            [
                "Dreyv treasury audit pack",
                `Period: ${data.period}`,
                `Wallet/vault: ${target}`,
                `Generated: ${data.generatedAt}`,
                "",
                "Files:",
                "  report.pdf       — human-readable summary",
                "  transactions.csv — every native + SPL transfer in period",
                "  proposals.csv    — every multisig proposal touching this wallet",
                "  raw.json         — machine-readable source of truth",
            ].join("\n"),
        );

        const zipBytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

        const artifact = await uploadArtifact({
            body: zipBytes,
            filename: `dreyv-audit-pack-${target.slice(0, 8)}-${input.month}.zip`,
            mime: "application/zip",
            kind: "zip",
            ownerKey: target,
            folder: `audit-packs/${input.month}`,
        });

        await logEpisode({
            capabilityId: "audit_pack_generate",
            walletAddress: target,
            outcome: "produced",
            notes: `period=${input.month}`,
            artifact,
        });

        return {
            success: true,
            operation: "audit_pack_generate",
            status: "completed" as const,
            period: data.period,
            wallet: target,
            artifacts: [artifact],
            message: `Audit pack ready (PDF + CSVs + raw JSON).`,
        };
    },
});

export const deliverableCapabilities: AnyCapability[] = [
    treasury_report_pdf as AnyCapability,
    treasury_report_csv as AnyCapability,
    audit_pack_generate as AnyCapability,
];
