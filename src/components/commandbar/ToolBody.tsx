"use client";

// Per-tool body registry — phase (c) of streaming-tool-card upgrade.
// Each tool gets its own structured body shape under the headline strip,
// instead of a single generic paragraph. Flat light/violet only.

import React from "react";
import {
  ArrowRight,
  Wallet,
  Coins,
  Users,
  ShieldCheck,
  Clock,
  ExternalLink,
  Activity,
  FileText,
  Globe,
  AlertTriangle,
  Layers,
} from "lucide-react";
import { DreyvStar } from "@/components/studio/DreyvStar";

interface Props {
  toolName: string;
  operation?: string;
  output?: Record<string, unknown> | undefined;
}

function shortAddr(a: unknown): string | null {
  if (typeof a !== "string" || a.length < 8) return null;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function fmtUsd(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(2)}k`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtPct(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ── Atoms ────────────────────────────────────────────────────────────────

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 tabular-nums">{children}</span>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 rounded-2xl border border-violet-100 bg-violet-50/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function AddressPill({ addr }: { addr: string }) {
  const label = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  return (
    <a
      href={`https://solscan.io/account/${addr}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-violet-100 bg-white px-1.5 py-0.5 font-mono text-[11px] text-violet-700 transition-colors hover:border-violet-300"
    >
      {label}
      <ExternalLink className="h-2.5 w-2.5" />
    </a>
  );
}

// ── Per-tool bodies ──────────────────────────────────────────────────────

function TransferBody({ output }: { output: Record<string, unknown> }) {
  const amount = output.amount ?? output.uiAmount;
  const token = (output.token ?? output.symbol) as string | undefined;
  const recipient = (output.recipient ?? output.destination ?? output.toAddress) as string | undefined;
  const sender = (output.sender ?? output.fromAddress) as string | undefined;
  const fee = output.feeUsd ?? output.fee;
  const memo = output.memo as string | undefined;

  return (
    <Section title="Transfer" icon={<Wallet className="h-3 w-3" />}>
      {sender && (
        <Row label="From">
          <AddressPill addr={sender} />
        </Row>
      )}
      {recipient && (
        <Row label="To">
          <AddressPill addr={recipient} />
        </Row>
      )}
      {amount !== undefined && (
        <Row label="Amount">
          {String(amount)} {token?.toUpperCase()}
        </Row>
      )}
      {typeof fee === "number" && <Row label="Network fee">{fmtUsd(fee) ?? `${fee}`}</Row>}
      {memo && <Row label="Memo">{memo}</Row>}
    </Section>
  );
}

function SwapBody({ output }: { output: Record<string, unknown> }) {
  const inAmt = output.inputAmount ?? output.amountIn;
  const inSym = (output.inputToken ?? output.fromSymbol) as string | undefined;
  const outAmt = output.outputAmount ?? output.amountOut;
  const outSym = (output.outputToken ?? output.toSymbol) as string | undefined;
  const route = output.route as string | undefined;
  const priceImpact = output.priceImpactPct as number | undefined;
  const slippage = output.slippageBps as number | undefined;
  const minOut = output.minimumReceived as number | string | undefined;

  return (
    <Section title="Swap route" icon={<ArrowRight className="h-3 w-3" />}>
      <div className="flex items-center justify-center gap-2 py-1 text-sm font-semibold text-slate-900 tabular-nums">
        <span>
          {String(inAmt)} <span className="text-slate-500">{inSym?.toUpperCase()}</span>
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-violet-500" />
        <span>
          {String(outAmt)} <span className="text-slate-500">{outSym?.toUpperCase()}</span>
        </span>
      </div>
      {route && <Row label="Route">{route}</Row>}
      {priceImpact !== undefined && (
        <Row label="Price impact">
          <span className={priceImpact > 1 ? "text-amber-600" : "text-slate-800"}>
            {fmtPct(priceImpact)}
          </span>
        </Row>
      )}
      {slippage !== undefined && <Row label="Slippage">{(slippage / 100).toFixed(2)}%</Row>}
      {minOut !== undefined && (
        <Row label="Min received">
          {String(minOut)} {outSym?.toUpperCase()}
        </Row>
      )}
    </Section>
  );
}

function MultisigBody({ output }: { output: Record<string, unknown> }) {
  const threshold = output.threshold as number | undefined;
  const memberCount = (output.memberCount ?? output.members) as number | undefined;
  const members = Array.isArray(output.memberAddresses) ? (output.memberAddresses as string[]) : [];
  const vault = (output.vaultPda ?? output.multisigPda ?? output.multisigAddress) as string | undefined;
  const proposalUrl = output.proposalUrl as string | undefined;
  const actions = Array.isArray(output.actions) ? (output.actions as Array<Record<string, unknown>>) : [];

  return (
    <Section title="Multisig proposal" icon={<ShieldCheck className="h-3 w-3" />}>
      {threshold !== undefined && memberCount !== undefined && (
        <Row label="Threshold">
          {threshold} of {memberCount}
        </Row>
      )}
      {vault && (
        <Row label="Vault">
          <AddressPill addr={vault} />
        </Row>
      )}
      {members.length > 0 && (
        <div className="py-1.5">
          <div className="mb-1 text-[12px] text-slate-500">Members</div>
          <div className="flex flex-wrap gap-1">
            {members.slice(0, 6).map((m) => (
              <AddressPill key={m} addr={m} />
            ))}
            {members.length > 6 && (
              <span className="text-[11px] text-slate-400">+{members.length - 6}</span>
            )}
          </div>
        </div>
      )}
      {actions.length > 0 && (
        <div className="py-1.5">
          <div className="mb-1 text-[12px] text-slate-500">Actions ({actions.length})</div>
          <ul className="space-y-1">
            {actions.slice(0, 4).map((a, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] text-slate-700"
              >
                <Layers className="h-3 w-3 text-violet-500" />
                {(a.kind as string) ?? (a.type as string) ?? `Action ${i + 1}`}
                {a.amount !== undefined && (
                  <span className="ml-auto font-mono text-slate-500">{String(a.amount)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposalUrl && (
        <a
          href={proposalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:underline"
        >
          Open in /team
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </Section>
  );
}

function ForesightBody({ output }: { output: Record<string, unknown> }) {
  const runway = output.runwayMonths as number | undefined;
  const burn = output.monthlyBurn as number | undefined;
  const inflow = output.monthlyInflow as number | undefined;
  const total = output.totalValuation as number | undefined;
  const depletion = output.depletionDate as string | undefined;
  const assumptions = Array.isArray(output.assumptions) ? (output.assumptions as string[]) : [];

  return (
    <Section title="Runway model" icon={<Activity className="h-3 w-3" />}>
      {total !== undefined && <Row label="Treasury">{fmtUsd(total) ?? String(total)}</Row>}
      {burn !== undefined && (
        <Row label="Monthly burn">
          <span className="text-rose-600">{fmtUsd(burn) ?? String(burn)}</span>
        </Row>
      )}
      {inflow !== undefined && (
        <Row label="Monthly inflow">
          <span className="text-emerald-600">{fmtUsd(inflow) ?? String(inflow)}</span>
        </Row>
      )}
      {runway !== undefined && Number.isFinite(runway) && (
        <Row label="Runway">{Math.round(runway).toLocaleString()} months</Row>
      )}
      {depletion && <Row label="Depletes">{depletion}</Row>}
      {assumptions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {assumptions.slice(0, 4).map((a, i) => (
            <span
              key={i}
              className="rounded-md bg-white px-1.5 py-0.5 text-[10px] text-slate-500"
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}

function ResearchBody({ output }: { output: Record<string, unknown> }) {
  const protocol = output.protocol as string | undefined;
  const summary = output.summary as string | undefined;
  const insights = Array.isArray(output.insights) ? (output.insights as string[]) : [];
  const sources = Array.isArray(output.sources)
    ? (output.sources as Array<{ title?: string; url?: string }>)
    : [];

  return (
    <Section title={protocol ? `Brief: ${protocol}` : "Research brief"} icon={<Globe className="h-3 w-3" />}>
      {summary && <p className="mb-1.5 text-[12px] leading-relaxed text-slate-700">{summary}</p>}
      {insights.length > 0 && (
        <ul className="space-y-1">
          {insights.slice(0, 4).map((ins, i) => (
            <li key={i} className="flex gap-1.5 text-[12px] text-slate-700">
              <Sparkles className="mt-0.5 h-3 w-3 flex-shrink-0 text-violet-500" />
              <span>{ins}</span>
            </li>
          ))}
        </ul>
      )}
      {sources.length > 0 && (
        <div className="mt-2 border-t border-violet-100 pt-1.5">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">
            Sources ({sources.length})
          </div>
          <div className="flex flex-col gap-0.5">
            {sources.slice(0, 5).map((s, i) =>
              s.url ? (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 truncate text-[11px] text-violet-700 hover:underline"
                >
                  <FileText className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{s.title ?? s.url}</span>
                </a>
              ) : (
                <span key={i} className="truncate text-[11px] text-slate-500">
                  {s.title}
                </span>
              ),
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function RiskBody({ output }: { output: Record<string, unknown> }) {
  const score = output.riskScore as number | undefined;
  const grade = output.grade as string | undefined;
  const factors = Array.isArray(output.factors)
    ? (output.factors as Array<{ name?: string; severity?: string; weight?: number }>)
    : [];

  return (
    <Section title="Risk factors" icon={<AlertTriangle className="h-3 w-3" />}>
      {score !== undefined && (
        <div className="mb-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-violet-100">
            <div
              className={`h-full rounded-full ${
                score > 70 ? "bg-rose-500" : score > 40 ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>0</span>
            <span className="font-semibold text-slate-700">
              {score.toFixed(0)}/100 {grade ? `· ${grade}` : ""}
            </span>
            <span>100</span>
          </div>
        </div>
      )}
      {factors.slice(0, 5).map((f, i) => (
        <Row key={i} label={f.name ?? `Factor ${i + 1}`}>
          <span
            className={
              f.severity === "high"
                ? "text-rose-600"
                : f.severity === "medium"
                  ? "text-amber-600"
                  : "text-slate-600"
            }
          >
            {f.severity ?? (f.weight !== undefined ? `${f.weight}` : "—")}
          </span>
        </Row>
      ))}
    </Section>
  );
}

function StudioBody({ output }: { output: Record<string, unknown> }) {
  const name = output.appName as string | undefined;
  const appId = output.appId as string | undefined;
  const template = output.template as string | undefined;
  const files = Array.isArray(output.files) ? (output.files as string[]) : [];

  return (
    <Section title="Mini-app scaffold" icon={<Sparkles className="h-3 w-3" />}>
      {name && <Row label="Name">{name}</Row>}
      {template && <Row label="Template">{template}</Row>}
      {appId && (
        <Row label="App ID">
          <span className="font-mono">{appId}</span>
        </Row>
      )}
      {files.length > 0 && (
        <div className="mt-1.5">
          <div className="mb-1 text-[12px] text-slate-500">Generated files</div>
          <div className="flex flex-wrap gap-1">
            {files.slice(0, 8).map((f) => (
              <span
                key={f}
                className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
              >
                {f}
              </span>
            ))}
            {files.length > 8 && (
              <span className="text-[10px] text-slate-400">+{files.length - 8}</span>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function YieldBody({ output }: { output: Record<string, unknown> }) {
  const protocol = (output.protocol ?? output.platform) as string | undefined;
  const apy = output.apy as number | undefined;
  const tvl = output.tvl as number | undefined;
  const amount = output.amount;
  const token = (output.token ?? output.symbol) as string | undefined;

  return (
    <Section title="Yield position" icon={<Coins className="h-3 w-3" />}>
      {protocol && <Row label="Protocol">{protocol}</Row>}
      {amount !== undefined && (
        <Row label="Amount">
          {String(amount)} {token?.toUpperCase()}
        </Row>
      )}
      {apy !== undefined && (
        <Row label="APY">
          <span className="text-emerald-600">{fmtPct(apy)}</span>
        </Row>
      )}
      {tvl !== undefined && <Row label="TVL">{fmtUsd(tvl) ?? String(tvl)}</Row>}
    </Section>
  );
}

// ── Registry ─────────────────────────────────────────────────────────────

export function ToolBody({ toolName, operation, output }: Props) {
  if (!output) return null;
  const op = operation ?? toolName;

  switch (op) {
    case "transfer":
    case "stake":
      return <TransferBody output={output} />;
    case "swap":
    case "execute_swap":
      return <SwapBody output={output} />;
    case "multisig_proposal":
    case "create_multisig":
      return <MultisigBody output={output} />;
    case "foresight_simulation":
      return <ForesightBody output={output} />;
    case "browser_research":
    case "protocol_research_brief":
      return <ResearchBody output={output} />;
    case "risk_assessment":
      return <RiskBody output={output} />;
    case "studio_init_miniapp":
      return <StudioBody output={output} />;
    case "yield_deposit":
    case "yield_withdraw":
      return <YieldBody output={output} />;
    default:
      return null;
  }
}
