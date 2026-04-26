/**
 * Phase 7A — CSV renderer
 *
 * Wraps papaparse with a strict header-first contract so capabilities
 * always emit deterministic, spreadsheet-friendly CSV.
 */

import Papa from "papaparse";

export interface CsvBuildInput<T> {
    rows: T[];
    /** Explicit column order. Required so output is stable across runs. */
    columns: (keyof T & string)[];
    /** Optional preamble lines (e.g. "# Dreyv treasury report — 2026-04"). */
    preamble?: string[];
}

export function buildCsv<T>(input: CsvBuildInput<T>): Buffer {
    const { rows, columns, preamble } = input;

    const csv = Papa.unparse(
        {
            fields: columns as string[],
            data: rows.map((r) => columns.map((c) => formatCell((r as Record<string, unknown>)[c]))),
        },
        { quotes: true, newline: "\n" },
    );

    const head = preamble?.length ? preamble.map((l) => `# ${l}`).join("\n") + "\n" : "";
    return Buffer.from(head + csv, "utf8");
}

function formatCell(v: unknown): string {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
}
