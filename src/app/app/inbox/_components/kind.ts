/**
 * Classify an inbox row into a user-facing "kind" from the plan's capabilities.
 * Replaces the old always-"rebalance" hardcoded label.
 */

export type InboxKind =
  | "report"
  | "brief"
  | "trade"
  | "yield"
  | "transfer"
  | "policy"
  | "watch"
  | "plan";

export type KindMeta = {
  kind: InboxKind;
  label: string;
  dotClass: string; // solid violet variants only
  textClass: string;
  bgClass: string;
  actionLabel: string; // e.g. "Approve & sign", "Generate", "Run"
};

const MAP: Record<string, InboxKind> = {
  treasury_report_pdf: "report",
  treasury_report_csv: "report",
  audit_pack_generate: "report",
  research_brief: "brief",
  protocol_brief: "brief",
  execute_swap: "trade",
  swap: "trade",
  rebalance: "trade",
  yield_deposit: "yield",
  yield_withdraw: "yield",
  transfer: "transfer",
  payroll_run: "transfer",
  update_policy: "policy",
  add_watcher: "watch",
  remove_watcher: "watch",
};

export function classifyPlan(capabilityIds: string[] | undefined | null): KindMeta {
  const ids = (capabilityIds ?? []).map((c) => (c ?? "").toLowerCase());
  let kind: InboxKind = "plan";
  for (const id of ids) {
    if (MAP[id]) {
      kind = MAP[id];
      break;
    }
    if (/(report|pdf|csv|audit|export)/.test(id)) {
      kind = "report";
      break;
    }
    if (/(brief|research|scan|analyze)/.test(id)) {
      kind = "brief";
      break;
    }
    if (/(swap|rebalance|route)/.test(id)) {
      kind = "trade";
      break;
    }
    if (/(yield|deposit|withdraw|stake)/.test(id)) {
      kind = "yield";
      break;
    }
    if (/(transfer|payroll|payout|pay)/.test(id)) {
      kind = "transfer";
      break;
    }
  }

  return META[kind];
}

const META: Record<InboxKind, KindMeta> = {
  report: {
    kind: "report",
    label: "Report",
    dotClass: "bg-violet-600",
    textClass: "text-violet-700",
    bgClass: "bg-violet-50",
    actionLabel: "Generate",
  },
  brief: {
    kind: "brief",
    label: "Brief",
    dotClass: "bg-violet-500",
    textClass: "text-violet-700",
    bgClass: "bg-violet-50",
    actionLabel: "Compile",
  },
  trade: {
    kind: "trade",
    label: "Trade",
    dotClass: "bg-violet-700",
    textClass: "text-violet-800",
    bgClass: "bg-violet-50",
    actionLabel: "Approve & sign",
  },
  yield: {
    kind: "yield",
    label: "Yield",
    dotClass: "bg-violet-700",
    textClass: "text-violet-800",
    bgClass: "bg-violet-50",
    actionLabel: "Approve & sign",
  },
  transfer: {
    kind: "transfer",
    label: "Transfer",
    dotClass: "bg-violet-700",
    textClass: "text-violet-800",
    bgClass: "bg-violet-50",
    actionLabel: "Approve & sign",
  },
  policy: {
    kind: "policy",
    label: "Policy",
    dotClass: "bg-slate-600",
    textClass: "text-slate-700",
    bgClass: "bg-slate-50",
    actionLabel: "Apply",
  },
  watch: {
    kind: "watch",
    label: "Watch",
    dotClass: "bg-slate-500",
    textClass: "text-slate-700",
    bgClass: "bg-slate-50",
    actionLabel: "Apply",
  },
  plan: {
    kind: "plan",
    label: "Plan",
    dotClass: "bg-violet-600",
    textClass: "text-violet-700",
    bgClass: "bg-violet-50",
    actionLabel: "Approve",
  },
};

export function formatUsd(v: number | string | null | undefined): string | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return null;
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
