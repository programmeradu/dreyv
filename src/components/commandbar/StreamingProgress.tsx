"use client";

// StreamingProgress — shown while a tool invocation is in `partial-call` or `call`
// state. Replaces the static "Executing…" spinner with a violet sweep bar +
// tool-aware phase labels that rotate, so the user sees the agent is working
// and roughly what stage it's in.
//
// Phase B of the streaming-tool-card upgrade.

import React from "react";

const PHASES_BY_TOOL: Record<string, string[]> = {
  transfer: ["Resolving recipient…", "Building transaction…", "Simulating…", "Ready to sign"],
  swap: ["Routing through Jupiter…", "Quoting price impact…", "Building transaction…", "Ready to sign"],
  execute_swap: ["Routing through Jupiter…", "Quoting price impact…", "Building transaction…", "Ready to sign"],
  multisig_proposal: ["Resolving vault PDA…", "Encoding actions…", "Building proposal tx…", "Ready to sign"],
  create_multisig: ["Generating createKey…", "Deriving PDAs…", "Building deploy tx…", "Ready to sign"],
  yield_deposit: ["Comparing vaults…", "Building deposit…", "Simulating…", "Ready to sign"],
  yield_withdraw: ["Resolving share balance…", "Building withdraw…", "Simulating…", "Ready to sign"],
  foresight_simulation: ["Loading basket…", "Running scenario…", "Projecting balances…", "Drafting narrative…"],
  browser_research: ["Searching the web…", "Fetching pages…", "Reading sources…", "Synthesizing brief…"],
  protocol_research_brief: ["Pulling docs…", "Reading SDK…", "Mapping risks…", "Writing brief…"],
  risk_assessment: ["Loading positions…", "Stress-testing…", "Scoring exposure…", "Drafting verdict…"],
  studio_init_miniapp: ["Reserving appId…", "Scaffolding files…", "Wiring SDK hooks…", "Ready"],
  studio_analyze_code: ["Reading source…", "Running analysis…", "Scoring quality…", "Drafting notes…"],
  rebalance: ["Reading current weights…", "Computing target trades…", "Building swaps…", "Ready to sign"],
  mass_dispatch: ["Resolving recipients…", "Batching transfers…", "Simulating…", "Ready to sign"],
  default: ["Working…", "Reasoning…", "Building output…", "Almost there…"],
};

export function StreamingProgress({ toolName }: { toolName: string }) {
  const phases = PHASES_BY_TOOL[toolName] ?? PHASES_BY_TOOL.default;
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    // Cycle phase labels every 1.4s. Stops at the last phase so it doesn't
    // imply infinite progress when the tool genuinely takes a while.
    const t = setInterval(() => {
      setIdx((i) => Math.min(i + 1, phases.length - 1));
    }, 1400);
    return () => clearInterval(t);
  }, [phases.length]);

  const progressPct = ((idx + 1) / phases.length) * 100;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="h-1 w-full overflow-hidden rounded-full bg-violet-50">
        <div
          className="h-full rounded-full bg-violet-600 transition-[width] duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="text-[11px] font-medium text-violet-700">{phases[idx]}</p>
    </div>
  );
}
