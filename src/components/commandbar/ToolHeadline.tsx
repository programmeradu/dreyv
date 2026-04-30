"use client";

// Per-tool headline strip — surfaces the 1–3 numbers/chips that matter
// for each capability so users see WHAT the tool produced at a glance,
// instead of having to read the body paragraph.
//
// Phase B of the streaming-tool-card upgrade. Flat light/violet only.

import React from "react";
import { ArrowRight, Users, Coins, ShieldCheck, Clock, FileText, Globe } from "lucide-react";

interface Props {
  toolName: string;
  operation?: string;
  output?: Record<string, unknown> | undefined;
}

function shortAddr(a: unknown): string | null {
  if (typeof a !== "string" || a.length < 8) return null;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function fmtAmount(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function Chip({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label?: string;
  value: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-100 bg-violet-50/60 px-2 py-1 text-[11px] font-medium text-violet-800">
      {icon}
      {label && <span className="font-normal text-slate-500">{label}</span>}
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function Headline({ value, suffix }: { value: React.ReactNode; suffix?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-lg font-semibold tracking-tight tabular-nums text-slate-900">{value}</span>
      {suffix && <span className="text-xs font-medium text-slate-500">{suffix}</span>}
    </div>
  );
}

export function ToolHeadline({ toolName, operation, output }: Props) {
  if (!output) return null;
  const op = operation ?? toolName;

  // ── Transfer / payroll-style: amount + token → recipient
  if (op === "transfer" || op === "yield_withdraw" || op === "yield_deposit" || op === "stake") {
    const amount = fmtAmount(output.amount ?? output.uiAmount);
    const token = (output.token ?? output.symbol ?? output.mint) as string | undefined;
    const recipient = shortAddr(output.recipient ?? output.destination ?? output.toAddress);
    if (!amount && !token && !recipient) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {amount && <Headline value={amount} suffix={token ? token.toUpperCase() : undefined} />}
        {recipient && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <ArrowRight className="h-3 w-3" />
            <span className="font-mono text-slate-700">{recipient}</span>
          </span>
        )}
      </div>
    );
  }

  // ── Swap: in → out
  if (op === "swap" || op === "execute_swap") {
    const inAmt = fmtAmount(output.inputAmount ?? output.amountIn);
    const inSym = (output.inputToken ?? output.fromSymbol) as string | undefined;
    const outAmt = fmtAmount(output.outputAmount ?? output.amountOut);
    const outSym = (output.outputToken ?? output.toSymbol) as string | undefined;
    if (!inAmt && !outAmt) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {inAmt && <Headline value={inAmt} suffix={inSym?.toUpperCase()} />}
        <ArrowRight className="h-4 w-4 text-violet-500" />
        {outAmt && <Headline value={outAmt} suffix={outSym?.toUpperCase()} />}
      </div>
    );
  }

  // ── Multisig proposal / create
  if (op === "multisig_proposal" || op === "create_multisig") {
    const threshold = output.threshold as number | undefined;
    const memberCount = (output.memberCount ?? output.members) as number | undefined;
    const actionCount = Array.isArray(output.actions) ? output.actions.length : undefined;
    const vault = shortAddr(output.vaultPda ?? output.multisigPda ?? output.multisigAddress);
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {threshold && memberCount && (
          <Chip icon={<ShieldCheck className="h-3 w-3" />} value={`${threshold} of ${memberCount}`} />
        )}
        {actionCount !== undefined && (
          <Chip icon={<Coins className="h-3 w-3" />} label="actions" value={actionCount} />
        )}
        {vault && <Chip icon={<Users className="h-3 w-3" />} label="vault" value={<span className="font-mono">{vault}</span>} />}
      </div>
    );
  }

  // ── Foresight: runway + depletion
  if (op === "foresight_simulation") {
    const runway = output.runwayMonths as number | undefined;
    const depletion = output.depletionDate as string | undefined;
    const burn = fmtAmount(output.monthlyBurn);
    if (runway === undefined && !depletion && !burn) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {runway !== undefined && Number.isFinite(runway) && (
          <Headline value={Math.round(runway).toLocaleString()} suffix="months runway" />
        )}
        {burn && <Chip icon={<Coins className="h-3 w-3" />} label="burn/mo" value={`$${burn}`} />}
        {depletion && <Chip icon={<Clock className="h-3 w-3" />} label="depletes" value={depletion} />}
      </div>
    );
  }

  // ── Research: source count + read time
  if (op === "browser_research" || op === "protocol_research_brief") {
    const sources = Array.isArray(output.sources) ? output.sources.length : (output.sourceCount as number | undefined);
    const protocol = output.protocol as string | undefined;
    const readMin = output.readTimeMinutes as number | undefined;
    if (!sources && !protocol) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {protocol && <Chip icon={<Globe className="h-3 w-3" />} value={protocol} />}
        {sources !== undefined && <Chip icon={<FileText className="h-3 w-3" />} label="sources" value={sources} />}
        {readMin !== undefined && <Chip icon={<Clock className="h-3 w-3" />} value={`${readMin} min read`} />}
      </div>
    );
  }

  // ── Studio init
  if (op === "studio_init_miniapp") {
    const appId = output.appId as string | undefined;
    const name = output.appName as string | undefined;
    if (!appId && !name) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {name && <Headline value={name} />}
        {appId && <Chip label="appId" value={<span className="font-mono">{appId.slice(0, 10)}…</span>} />}
      </div>
    );
  }

  // ── Risk assessment
  if (op === "risk_assessment") {
    const score = output.riskScore as number | undefined;
    const grade = output.grade as string | undefined;
    if (score === undefined && !grade) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {score !== undefined && <Headline value={score.toFixed(0)} suffix="/100 risk" />}
        {grade && <Chip value={grade} />}
      </div>
    );
  }

  return null;
}
