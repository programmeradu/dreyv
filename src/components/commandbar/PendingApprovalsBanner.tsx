"use client";

/**
 * PendingApprovalsBanner — slim violet pill rendered below the chat's
 * PipelineHeader. Polls /api/inbox/command-approvals + /api/inbox/tx-proposals
 * and links the user straight to /app/inbox. This is the "queued for approval"
 * → "View in inbox" handoff so users never wonder where their plan went.
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";

interface Props {
  wallet: string | null;
}

export function PendingApprovalsBanner({ wallet }: Props) {
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const q = wallet ? `?wallet=${wallet}` : "";
      try {
        const [ca, tx] = await Promise.all([
          fetch(`/api/inbox/command-approvals${q}`, { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => ({ approvals: [] })),
          fetch(`/api/inbox/tx-proposals${q}`, { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => ({ txProposals: [] })),
        ]);
        if (cancelled) return;
        const total = (ca?.approvals?.length ?? 0) + (tx?.txProposals?.length ?? 0);
        setCount(total);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    const t = setInterval(load, 12_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [wallet]);

  if (!loaded || count === 0) return null;

  return (
    <Link
      href="/app/inbox"
      className="group mx-3 mt-2 mb-1 flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/70 px-3.5 py-2.5 text-[12.5px] text-violet-900 transition-colors hover:bg-violet-100"
    >
      <span className="flex items-center gap-2 font-medium">
        <ShieldCheck className="h-4 w-4 text-violet-600" />
        <span>
          <span className="font-semibold">{count}</span>{" "}
          {count === 1 ? "action awaits" : "actions await"} your approval
        </span>
      </span>
      <span className="flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-wider text-violet-700 group-hover:text-violet-900">
        View inbox <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
