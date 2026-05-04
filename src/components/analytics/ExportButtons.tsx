"use client";

/**
 * Quiet, footer-grade export links for the analytics page.
 * Demoted to thin text-style links so the chart leads, not the buttons.
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

  const linkCls = `inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
    disabled
      ? "cursor-not-allowed text-slate-300"
      : "text-slate-500 hover:text-violet-700"
  }`;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-violet-100 pt-3">
      <a
        href={csvHref}
        aria-disabled={disabled}
        onClick={(e) => disabled && e.preventDefault()}
        className={linkCls}
        download
      >
        <Download className="h-3 w-3" />
        Events · spreadsheet
      </a>
      <a
        href={pdfHref}
        aria-disabled={disabled}
        onClick={(e) => disabled && e.preventDefault()}
        target="_blank"
        rel="noopener noreferrer"
        className={linkCls}
      >
        <FileText className="h-3 w-3" />
        Report · branded PDF
      </a>
      <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-slate-400">
        {disabled ? "connect a wallet" : `${range} window`}
      </span>
    </div>
  );
}
