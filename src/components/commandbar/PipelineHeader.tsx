"use client";

/**
 * DACS Phase 5 — CommandBar PipelineHeader.
 *
 * Surfaces the live state of the DACS pipeline above the chat thread:
 *   • Intent badge        — heuristic classification of the user's last prompt
 *                           (kind + emoji), so the user can see how dreyv read
 *                           their request before the planner finishes.
 *   • Active specialist   — the most recent specialist accepted/working from
 *                           `/api/dacs/handoffs/stream` (subscribed elsewhere
 *                           in the bar; passed in via prop to avoid double
 *                           SSE).
 *   • Episode-recall chip — fetched from `/api/dacs/episodes/recall` keyed on
 *                           (wallet, intent.kind). Shows past N runs of this
 *                           intent + approval rate so the user understands the
 *                           planner's risk bias.
 *
 * Intentionally header-only: all execution UI lives in ChatMessage / ToolCard.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Compass,
  ArrowLeftRight,
  Sprout,
  Search,
  Wrench,
  Eye,
  ShieldCheck,
  CreditCard,
  AlertTriangle,
  Navigation,
  MessageCircle,
  HelpCircle,
  History,
  Network,
} from "lucide-react";

// ─── Intent kind metadata ────────────────────────────────────────────────────

type IntentKind =
  | "treasury_action"
  | "trade"
  | "yield_action"
  | "research"
  | "build"
  | "monitor"
  | "policy_setup"
  | "payment"
  | "risk_check"
  | "navigate"
  | "chitchat"
  | "unknown";

const INTENT_META: Record<
  IntentKind,
  { label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  treasury_action: { label: "Treasury", Icon: Compass },
  trade: { label: "Trade", Icon: ArrowLeftRight },
  yield_action: { label: "Yield", Icon: Sprout },
  research: { label: "Research", Icon: Search },
  build: { label: "Build", Icon: Wrench },
  monitor: { label: "Monitor", Icon: Eye },
  policy_setup: { label: "Policy", Icon: ShieldCheck },
  payment: { label: "Payment", Icon: CreditCard },
  risk_check: { label: "Risk", Icon: AlertTriangle },
  navigate: { label: "Navigate", Icon: Navigation },
  chitchat: { label: "Chat", Icon: MessageCircle },
  unknown: { label: "Intent", Icon: HelpCircle },
};

/**
 * Lightweight client-side classifier — purely cosmetic, used only for the
 * pre-stream badge. The server-side planner remains the source of truth for
 * actual capability routing.
 */
function classifyIntent(text: string): IntentKind {
  const t = text.toLowerCase().trim();
  if (!t) return "unknown";
  if (/\b(swap|trade|buy|sell|jupiter|raydium)\b/.test(t)) return "trade";
  if (/\b(stake|unstake|yield|apy|farm|lp|marinade|liquid stake)\b/.test(t)) return "yield_action";
  if (/\b(send|transfer|pay|payroll|invoice|streamflow)\b/.test(t)) return "payment";
  if (/\b(simulate|forecast|what if|scenario|stress|foresight)\b/.test(t)) return "risk_check";
  if (/\b(monitor|watch|alert|notify|when|trigger)\b/.test(t)) return "monitor";
  if (/\b(policy|cap|limit|guardrail|approve|hitl)\b/.test(t)) return "policy_setup";
  if (/\b(deploy|build|scaffold|mini.?app|studio|publish)\b/.test(t)) return "build";
  if (/\b(go to|open|navigate|show me|take me)\b/.test(t)) return "navigate";
  if (/\b(price|trending|holders|mev|airdrop|rug|atlas)\b/.test(t)) return "research";
  if (/\b(rebalance|burn|runway|treasury|vault|portfolio)\b/.test(t)) return "treasury_action";
  if (/^(hi|hey|hello|gm|thanks|thx|sup)\b/.test(t)) return "chitchat";
  return "unknown";
}

// ─── Recall API ──────────────────────────────────────────────────────────────

interface RecallSummary {
  total: number;
  byOutcome: Record<string, number>;
  approvalRate: number | null;
}

function useEpisodeRecall(wallet: string | null, intent: IntentKind | null) {
  const [recall, setRecall] = useState<RecallSummary | null>(null);

  useEffect(() => {
    if (!wallet || !intent || intent === "unknown" || intent === "chitchat") {
      setRecall(null);
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    fetch(`/api/dacs/episodes/recall?wallet=${encodeURIComponent(wallet)}&intent=${encodeURIComponent(intent)}`, {
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setRecall({
          total: data.total ?? 0,
          byOutcome: data.byOutcome ?? {},
          approvalRate: data.approvalRate ?? null,
        });
      })
      .catch(() => {
        /* best-effort */
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [wallet, intent]);

  return recall;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface PipelineHeaderProps {
  /** The user's most recent prompt — drives the intent badge + recall query. */
  lastUserPrompt: string | null;
  /** Connected wallet (base58). */
  wallet: string | null;
  /** Active specialist id (e.g. "yield-agent") if a handoff is in-flight. */
  activeSpecialist?: string | null;
  /** Show "thinking" pulse on the badge while the agent is streaming. */
  busy?: boolean;
}

export function PipelineHeader({
  lastUserPrompt,
  wallet,
  activeSpecialist,
  busy,
}: PipelineHeaderProps) {
  const intent = useMemo<IntentKind | null>(
    () => (lastUserPrompt ? classifyIntent(lastUserPrompt) : null),
    [lastUserPrompt],
  );
  const recall = useEpisodeRecall(wallet, intent);

  if (!intent && !activeSpecialist) return null;

  const meta = intent ? INTENT_META[intent] : null;
  const IntentIcon = meta?.Icon ?? HelpCircle;

  const approvalPct =
    recall?.approvalRate != null ? Math.round(recall.approvalRate * 100) : null;

  return (
    <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-2 flex-wrap">
      {/* Intent badge */}
      {meta && (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider ${
            busy ? "animate-pulse" : ""
          }`}
          title={`Detected intent: ${meta.label}`}
        >
          <IntentIcon size={11} />
          {meta.label}
        </span>
      )}

      {/* Active specialist */}
      {activeSpecialist && (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 text-[10px] font-bold uppercase tracking-wider"
          title={`Specialist handling this turn: ${activeSpecialist}`}
        >
          <Network size={11} />
          {activeSpecialist.replace(/-agent$/, "").replace(/-/g, " ")}
        </span>
      )}

      {/* Episode-recall chip */}
      {recall && recall.total > 0 && (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 text-[10px] font-medium"
          title={`Past ${recall.total} ${meta?.label.toLowerCase() ?? "intent"} runs${
            approvalPct != null ? ` · ${approvalPct}% approval` : ""
          }`}
        >
          <History size={11} />
          <span className="font-bold">{recall.total}</span>
          <span className="opacity-70">past run{recall.total === 1 ? "" : "s"}</span>
          {approvalPct != null && (
            <span className="opacity-70">· {approvalPct}% approved</span>
          )}
        </span>
      )}
    </div>
  );
}
