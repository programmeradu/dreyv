"use client";

/**
 * One-click CSV export buttons for the analytics page.
 * Renders a small group of flat violet outline buttons that hit the
 * /api/treasury/exports/* endpoints with the active wallet + range.
 */

import { Download, FileText } from "lucide-react";
import { useVault } from "@/lib/contexts/VaultContext";

export function ExportButtons({ range = "30d" }: { range?: string }) {
  const { activeVault } = useVault();
  const disabled = !activeVault;

  const qs = activeVault
    ? `wallet=${encodeURIComponent(activeVault)}&range=${range}`
    : "";

  const csvHref = activeVault ? `/api/treasury/exports/events.csv?${qs}` : "#";
  const pdfHref = activeVault ? `/api/treasury/exports/report.pdf?${qs}` : "#";

  const baseCls = `inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition ${
    disabled ? "cursor-not-allowed opacity-50" : ""
  }`;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={csvHref}
        aria-disabled={disabled}
        onClick={(e) => disabled && e.preventDefault()}
        className={`${baseCls} border-violet-200 bg-white text-violet-700 ${
          disabled ? "" : "hover:border-violet-300 hover:bg-violet-50"
        }`}
        download
      >
        <Download className="h-4 w-4" />
        Events CSV
      </a>
      <a
        href={pdfHref}
        aria-disabled={disabled}
        onClick={(e) => disabled && e.preventDefault()}
        target="_blank"
        rel="noopener noreferrer"
        className={`${baseCls} border-violet-600 bg-violet-600 text-white ${
          disabled ? "" : "hover:bg-violet-700 hover:border-violet-700"
        }`}
      >
        <FileText className="h-4 w-4" />
        PDF Report
      </a>
      <span className="text-xs text-slate-500">
        {disabled ? "Connect a wallet to export." : `${range} window · spreadsheet + branded report`}
      </span>
    </div>
  );
}
