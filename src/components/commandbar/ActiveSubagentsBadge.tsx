"use client";

/**
 * ActiveSubagentsBadge — small badge showing how many subagents are running
 * right now, plus a count of pending approvals. Powered by AgentContext.
 *
 * Designed to live inside the CommandBar header so the operator always sees
 * the live state of their agent fleet without leaving the input.
 */

import Link from "next/link";
import { Bot, BellDot } from "lucide-react";
import { useAgentContext } from "@/lib/contexts/AgentContext";

export function ActiveSubagentsBadge() {
    const { activeSubagentCount, pendingApprovalCount } = useAgentContext();
    if (activeSubagentCount === 0 && pendingApprovalCount === 0) return null;
    return (
        <div className="inline-flex items-center gap-1.5">
            {activeSubagentCount > 0 && (
                <Link
                    href="/app/settings"
                    title={`${activeSubagentCount} subagent${activeSubagentCount === 1 ? "" : "s"} running`}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 transition-colors hover:bg-violet-100"
                >
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-600" />
                    </span>
                    <Bot className="h-3 w-3" />
                    {activeSubagentCount}
                </Link>
            )}
            {pendingApprovalCount > 0 && (
                <Link
                    href="/app/inbox"
                    title={`${pendingApprovalCount} pending approval${pendingApprovalCount === 1 ? "" : "s"}`}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-100"
                >
                    <BellDot className="h-3 w-3" />
                    {pendingApprovalCount}
                </Link>
            )}
        </div>
    );
}
