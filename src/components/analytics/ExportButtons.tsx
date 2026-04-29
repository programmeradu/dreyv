"use client";

/**
 * One-click CSV export buttons for the analytics page.
 * Renders a small group of flat violet outline buttons that hit the
 * /api/treasury/exports/* endpoints with the active wallet + range.
 */

import { Download } from "lucide-react";
import { useVault } from "@/lib/contexts/VaultContext";

export function ExportButtons({ range = "30d" }: { range?: string }) {
  const { activeVault } = useVault();
  const disabled = !activeVault;

  const csvHref = activeVault
    ? `/api/treasury/exports/events.csv?wallet=${encodeURIComponent(activeVault)}&range=${range}`
    : "#";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={csvHref}
        aria-disabled={disabled}
        onClick={(e) => disabled && e.preventDefault()}
        className={`inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 transition ${
          disabled ? "cursor-not-allowed opacity-50" : "hover:border-violet-300 hover:bg-violet-50"
        }`}
        download
      >
        <Download className="h-4 w-4" />
        Events CSV
      </a>
      <span className="text-xs text-slate-500">
        {disabled ? "Connect a wallet to export." : `${range} window · spreadsheet-ready`}
      </span>
    </div>
  );
}
