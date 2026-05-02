"use client";

/**
 * TreasuryCommandDock — inline, scoped action affordance for `/app/treasury`.
 *
 * Why an inline dock and not a second floating bar:
 *   The global <CommandBar /> (mounted in /app/layout.tsx) is the single input
 *   surface. Two bars = confusion. Instead, this dock surfaces 4 contextual
 *   prompts derived from the user's actual treasury state and emits
 *   AGENT_COMMAND through the bus — CommandBar opens, prefills, and runs.
 *
 * Scope: treasury / payments / policy / risk / yield (all 5 treasury domains).
 *
 * Design rules (locked):
 *   - Flat: rounded-3xl, border-violet-100, bg-white. No shadows / blur /
 *     gradients / ring.
 *   - Solid violet only (#7c3aed, violet-600). No fuchsia/pink.
 *   - Manrope. Stitch-light.
 *   - NEVER show invented numbers. Prompts adapt to real vault state; if no
 *     wallet, the dock asks the user to connect / paste an address.
 */

import { useMemo } from "react";
import { useVault } from "@/lib/contexts/VaultContext";
import { AppEventBus } from "@/lib/events";

const STABLES = new Set(["USDC", "USDT", "PYUSD", "USDH", "DAI"]);

interface DockSuggestion {
  /** Short button label (≤ 4 words). */
  label: string;
  /** Human prompt sent to the agent — calm, founder-to-founder. */
  prompt: string;
  /** Domain tag — surfaces as a tiny pill so the user knows what'll run. */
  domain: "treasury" | "payments" | "policy" | "risk" | "yield";
  /** When true, run immediately; otherwise just prefill the bar. */
  autoSubmit?: boolean;
}

const DOMAIN_LABEL: Record<DockSuggestion["domain"], string> = {
  treasury: "Treasury",
  payments: "Payments",
  policy: "Policy",
  risk: "Risk",
  yield: "Yield",
};

function fmtUsdShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toFixed(0)}`;
}

/**
 * Derive 4 contextual suggestions from real vault state.
 * No invented numbers — every figure that appears in a prompt is read from
 * useVault() (live RPC) or the user's connected multisig config.
 */
function deriveSuggestions(args: {
  hasWallet: boolean;
  isMultisig: boolean;
  stableBalance: number;
  vaultValue: number | null;
  topToken: string | null;
}): DockSuggestion[] {
  const { hasWallet, isMultisig, stableBalance, vaultValue, topToken } = args;

  // Empty / not-connected state — only ask for context, never fabricate.
  if (!hasWallet) {
    return [
      {
        label: "Connect a wallet",
        prompt: "Connect a wallet so you can watch my treasury.",
        domain: "treasury",
      },
      {
        label: "Watch an address",
        prompt: "Watch this Solana address read-only: ",
        domain: "treasury",
      },
      {
        label: "Set up a Squads multisig",
        prompt: "Help me set up a Squads multisig for my treasury.",
        domain: "treasury",
      },
      {
        label: "Show me an example",
        prompt: "Walk me through what a connected treasury would look like.",
        domain: "treasury",
      },
    ];
  }

  const out: DockSuggestion[] = [];

  // 1. Yield — only when there's real idle stables to talk about.
  if (stableBalance > 100) {
    out.push({
      label: "Earn on idle stables",
      prompt: `Route ${fmtUsdShort(stableBalance)} of idle stables to a vetted yield venue inside my conservative band.`,
      domain: "yield",
    });
  } else {
    out.push({
      label: "Plan a yield route",
      prompt: "Set up a yield route that activates the moment idle stables land.",
      domain: "yield",
    });
  }

  // 2. Payments — mass send / payroll batch
  out.push({
    label: "Mass send-out",
    prompt: "Help me prepare a mass send-out — payroll, grants, or airdrops.",
    domain: "payments",
  });

  // 3. Policy — set or refine spending policy. Multisig users get a
  //    different prompt because their approval flow already exists.
  out.push(
    isMultisig
      ? {
          label: "Refine signer policy",
          prompt: "Audit my Squads signer roster and suggest a policy update.",
          domain: "policy",
        }
      : {
          label: "Set spending policy",
          prompt: "Set a daily spending limit and an allowlist for my treasury.",
          domain: "policy",
        },
  );

  // 4. Risk — concentration / runway / counterparty
  if (vaultValue && vaultValue > 0 && topToken) {
    out.push({
      label: "Check concentration",
      prompt: `Check my treasury concentration — is ${topToken} too large a share?`,
      domain: "risk",
    });
  } else {
    out.push({
      label: "Check runway",
      prompt: "Estimate my runway from the last 90 days of outflows.",
      domain: "risk",
    });
  }

  return out;
}

export function TreasuryCommandDock() {
  const { vaultTokens, vaultValue, activeVault, isMultisig } = useVault();

  const { stableBalance, topToken } = useMemo(() => {
    const tokens = (vaultTokens ?? []) as Array<{ symbol?: string; value?: number }>;
    const stables = tokens
      .filter((t) => STABLES.has((t.symbol ?? "").toUpperCase()))
      .reduce((s, t) => s + (typeof t.value === "number" ? t.value : 0), 0);
    const sorted = [...tokens]
      .filter((t) => typeof t.value === "number" && t.value > 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const top = sorted[0]?.symbol ? sorted[0].symbol.toUpperCase() : null;
    return { stableBalance: stables, topToken: top };
  }, [vaultTokens]);

  const suggestions = useMemo(
    () =>
      deriveSuggestions({
        hasWallet: !!activeVault,
        isMultisig,
        stableBalance,
        vaultValue,
        topToken,
      }),
    [activeVault, isMultisig, stableBalance, vaultValue, topToken],
  );

  const send = (s: DockSuggestion) => {
    AppEventBus.emit("AGENT_COMMAND", {
      command: s.prompt,
      autoSubmit: s.autoSubmit ?? false,
    });
  };

  return (
    <div className="rounded-3xl border border-violet-100 bg-white px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">
            Ask Dreyv
          </p>
          <h3 className="mt-0.5 font-manrope text-base font-semibold tracking-tight text-slate-900">
            What would you like to do next?
          </h3>
        </div>
        <button
          type="button"
          onClick={() =>
            AppEventBus.emit("AGENT_COMMAND", {
              command: "What can you do for my treasury?",
              autoSubmit: false,
            })
          }
          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
        >
          Open command bar
        </button>
      </div>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <li key={`${s.domain}:${s.label}`}>
            <button
              type="button"
              onClick={() => send(s)}
              className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white px-3 py-2.5 text-left hover:border-violet-300 hover:bg-violet-50/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-violet-800">
                  {s.label}
                </p>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                  {s.prompt}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                {DOMAIN_LABEL[s.domain]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
