// Feature: commandbar-god-mode
// Shared TOOL_META registry for all tool invocation UI across CommandBar sub-components.

export const TOOL_META: Record<string, { label: string; color: string; icon: string }> = {
  swap: { label: "Swap", color: "text-blue-400", icon: "⚡" },
  execute_swap: { label: "Swap", color: "text-blue-400", icon: "⚡" },
  transfer: { label: "Transfer", color: "text-purple-400", icon: "📤" },
  stake: { label: "Stake", color: "text-emerald-400", icon: "🔒" },
  bridge: { label: "Bridge", color: "text-cyan-400", icon: "🌉" },
  yield_deposit: { label: "Deposit", color: "text-green-400", icon: "📥" },
  yield_withdraw: { label: "Withdraw", color: "text-orange-400", icon: "📤" },
  rebalance: { label: "Rebalance", color: "text-indigo-400", icon: "⚖️" },
  mass_dispatch: { label: "Payroll", color: "text-pink-400", icon: "💸" },
  create_multisig: { label: "Create Squad", color: "text-emerald-400", icon: "🛡️" },
  multisig_proposal: { label: "Proposal", color: "text-amber-400", icon: "🏛️" },
  execute_dca: { label: "DCA", color: "text-teal-400", icon: "📊" },
  foresight_simulation: { label: "Foresight", color: "text-violet-400", icon: "🔮" },
  risk_assessment: { label: "Risk Radar", color: "text-red-400", icon: "🎯" },
  browser_research: { label: "Research", color: "text-purple-400", icon: "🔍" },
  idl_extraction: { label: "IDL Extract", color: "text-yellow-400", icon: "📄" },
  sentiment_analysis: { label: "Sentiment", color: "text-sky-400", icon: "📡" },
  studio_init_miniapp: { label: "Init App", color: "text-emerald-400", icon: "🚀" },
  studio_analyze_code: { label: "Analyze", color: "text-blue-400", icon: "🔬" },
  security_firewall: { label: "Firewall", color: "text-red-400", icon: "🛡️" },
  marketplace_publish: { label: "Publish", color: "text-green-400", icon: "🏪" },
  sdk_hooks: { label: "SDK Hooks", color: "text-cyan-400", icon: "🪝" },
  navigate: { label: "Navigate", color: "text-muted-foreground", icon: "🧭" },
  set_monitor: { label: "Monitor", color: "text-amber-400", icon: "👁️" },
  deploy_sniper_bot: { label: "Sniper Bot", color: "text-red-400", icon: "🎯" },
  protocol_sdk_analyze: { label: "SDK Analyze", color: "text-yellow-400", icon: "🔬" },
  // Synthetic pipeline personas (surfaced by AgentsRail from tool-output fields).
  simulation_firewall: { label: "Simulation Firewall", color: "text-rose-400", icon: "🛡️" },
  route_simulator: { label: "Route Simulator", color: "text-violet-400", icon: "🧪" },
  risk_sentinel: { label: "Risk Sentinel", color: "text-amber-400", icon: "🎯" },
  mev_guard: { label: "MEV Guard", color: "text-sky-400", icon: "🛰️" },
  token_resolver: { label: "Token Resolver", color: "text-emerald-400", icon: "🔎" },
  treasury_watcher: { label: "Treasury Watcher", color: "text-violet-400", icon: "👁️" },
  yield_optimizer: { label: "Yield Optimizer", color: "text-emerald-400", icon: "🌱" },
};

/**
 * Friendly label for any capability/tool id. Falls back to a humanized form
 * (snake_case → Title Case) so we never leak internal codenames into the UI.
 */
export function toolLabel(id: string): string {
  if (!id) return "Step";
  const meta = TOOL_META[id];
  if (meta?.label) return meta.label;
  return id
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Short, human-readable description of what this agent watches/does. Used by
 * AgentsRail as the small subtitle under the agent name.
 */
export const TOOL_WATCHING: Record<string, string> = {
  swap: "executing token swaps",
  execute_swap: "executing token swaps",
  transfer: "moving funds",
  stake: "stake & unstake flows",
  bridge: "cross-chain bridges",
  yield_deposit: "deposit routing",
  yield_withdraw: "withdrawal routing",
  rebalance: "portfolio balance",
  mass_dispatch: "payroll batches",
  create_multisig: "Squad setup",
  multisig_proposal: "proposal drafting",
  execute_dca: "DCA schedules",
  foresight_simulation: "scenario forecasts",
  risk_assessment: "drawdown & exposure",
  browser_research: "live web research",
  idl_extraction: "on-chain IDL parsing",
  sentiment_analysis: "social & news signals",
  studio_init_miniapp: "Studio scaffolding",
  studio_analyze_code: "code review",
  security_firewall: "outgoing transactions",
  marketplace_publish: "marketplace publishing",
  sdk_hooks: "SDK surface",
  navigate: "in-app navigation",
  set_monitor: "ongoing watchers",
  deploy_sniper_bot: "launch sniping",
  protocol_sdk_analyze: "protocol SDKs",
  simulation_firewall: "outgoing transactions",
  route_simulator: "on-chain simulation",
  risk_sentinel: "drawdown & exposure",
  mev_guard: "swap routes",
  token_resolver: "unknown token contracts",
  treasury_watcher: "balance & flows",
  yield_optimizer: "Kamino · Marinade · MarginFi",
};

export function toolWatching(id: string): string {
  return TOOL_WATCHING[id] ?? "live capability";
}
