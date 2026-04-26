/**
 * DACS Phase 3 — Nightly policy derivation cron.
 *
 * Reads recent episodes per wallet and:
 *   1. Auto-applies low-risk policy changes (e.g. add a protocol the user
 *      has approved 3+ times with zero rejections, when the values stay
 *      below their existing daily cap).
 *   2. Records higher-impact suggestions (raise auto-approve threshold,
 *      lower daily cap) into `user_agent_policy.pending_suggestions` for
 *      the user to review in /app/settings.
 *
 * Runs daily at 03:00 UTC. Idempotent: pending suggestions are deduped by
 * `kind + value` so re-running won't pile up duplicates.
 *
 * "Auto-apply low-risk" definition (locked):
 *   - allowlist additions only
 *   - capability must have appeared in ≥3 episodes in the last 14 days
 *   - 0 rejected/cancelled outcomes for that capability in the window
 *   - max episode value ≤ user's current dailyValueCapUsd (or, if no cap
 *     set, ≤ user's autoApproveBelowUsd × 5)
 *   - capability's protocols must not already be in denylist
 */

import { inngest } from "../inngest-client";
import { db } from "@/db";
import { agentEpisodes, userAgentPolicy } from "@/db/schema";
import { and, desc, gte, isNotNull } from "drizzle-orm";
import { capabilityRegistry } from "../capabilities/registry";

interface Suggestion {
  id: string;
  kind:
    | "add_protocol_allowlist"
    | "raise_auto_approve_threshold"
    | "lower_daily_cap"
    | "add_protocol_denylist";
  value: unknown;
  rationale: string;
  confidence: number;
  createdAt: string;
}

interface PolicyRow {
  walletAddress: string;
  autoApproveBelowUsd: string | null;
  requireMultisigAboveUsd: string | null;
  protocolAllowlist: unknown;
  protocolDenylist: unknown;
  dailyValueCapUsd: string | null;
  pendingSuggestions: unknown;
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

function asSuggestions(v: unknown): Suggestion[] {
  return Array.isArray(v) ? (v as Suggestion[]) : [];
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

interface CapStats {
  capabilityId: string;
  total: number;
  approved: number;
  autoExecuted: number;
  rejected: number;
  failed: number;
  maxValueUsd: number;
}

interface EpisodeRow {
  capabilityIds: unknown;
  outcome: string;
  valueUsd: string | null;
  walletAddress: string | null;
  createdAt: Date | string;
}

function summarize(episodes: EpisodeRow[]): Map<string, CapStats> {
  const stats = new Map<string, CapStats>();
  for (const ep of episodes) {
    const caps = Array.isArray(ep.capabilityIds) ? (ep.capabilityIds as string[]) : [];
    const value = ep.valueUsd ? Number(ep.valueUsd) : 0;
    for (const capId of caps) {
      let s = stats.get(capId);
      if (!s) {
        s = {
          capabilityId: capId,
          total: 0,
          approved: 0,
          autoExecuted: 0,
          rejected: 0,
          failed: 0,
          maxValueUsd: 0,
        };
        stats.set(capId, s);
      }
      s.total += 1;
      if (ep.outcome === "approved_executed") s.approved += 1;
      else if (ep.outcome === "auto_executed") s.autoExecuted += 1;
      else if (ep.outcome === "rejected" || ep.outcome === "cancelled") s.rejected += 1;
      else if (ep.outcome === "approved_failed" || ep.outcome === "expired") s.failed += 1;
      if (value > s.maxValueUsd) s.maxValueUsd = value;
    }
  }
  return stats;
}

interface DerivationResult {
  walletAddress: string;
  autoApplied: Suggestion[];
  proposed: Suggestion[];
}

function derive(policy: PolicyRow, episodes: EpisodeRow[]): DerivationResult {
  const result: DerivationResult = {
    walletAddress: policy.walletAddress,
    autoApplied: [],
    proposed: [],
  };

  if (episodes.length === 0) return result;

  const stats = summarize(episodes);
  const allowlist = new Set(asArray(policy.protocolAllowlist));
  const denylist = new Set(asArray(policy.protocolDenylist));
  const autoApproveBelow = policy.autoApproveBelowUsd ? Number(policy.autoApproveBelowUsd) : 0;
  const dailyCap = policy.dailyValueCapUsd ? Number(policy.dailyValueCapUsd) : null;
  const safeValueCeiling = dailyCap ?? autoApproveBelow * 5;

  const registry = capabilityRegistry();
  const protocolsToAdd = new Set<string>();

  // ── 1. Auto-apply: add protocols the user has demonstrably approved ──
  for (const s of stats.values()) {
    const successes = s.approved + s.autoExecuted;
    if (successes < 3) continue;
    if (s.rejected > 0) continue;
    if (safeValueCeiling > 0 && s.maxValueUsd > safeValueCeiling) continue;

    const cap = registry.get(s.capabilityId);
    if (!cap) continue;
    const protos = (cap as { protocols?: string[] }).protocols ?? [];
    for (const p of protos) {
      if (allowlist.has(p) || denylist.has(p)) continue;
      protocolsToAdd.add(p);
      result.autoApplied.push({
        id: newId("sug"),
        kind: "add_protocol_allowlist",
        value: p,
        rationale: `Auto-applied: ${successes} successful executions of "${s.capabilityId}" via ${p}, 0 rejections, max value $${s.maxValueUsd.toFixed(2)}`,
        confidence: 0.9,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // ── 2. Propose: raise auto-approve threshold ──────────────────────────
  // If there are ≥3 approved-executed episodes whose value sits between the
  // current threshold and 2x the threshold, suggest raising it to that level.
  if (autoApproveBelow > 0) {
    const approvedAbove = episodes.filter(
      (ep) =>
        ep.outcome === "approved_executed" &&
        ep.valueUsd != null &&
        Number(ep.valueUsd) > autoApproveBelow &&
        Number(ep.valueUsd) <= autoApproveBelow * 2,
    );
    if (approvedAbove.length >= 3) {
      const maxVal = Math.max(...approvedAbove.map((e) => Number(e.valueUsd ?? 0)));
      const suggested = Math.ceil(maxVal / 50) * 50; // round to nearest $50
      result.proposed.push({
        id: newId("sug"),
        kind: "raise_auto_approve_threshold",
        value: suggested,
        rationale: `${approvedAbove.length} approvals between $${autoApproveBelow} and $${(autoApproveBelow * 2).toFixed(0)} in last 14d (max $${maxVal.toFixed(2)}). Raising the threshold would auto-execute these.`,
        confidence: 0.7,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // ── 3. Propose: lower daily cap if a recent episode crossed it ────────
  if (dailyCap != null) {
    const crossings = episodes.filter(
      (ep) => ep.valueUsd != null && Number(ep.valueUsd) > dailyCap,
    );
    if (crossings.length > 0) {
      const median = (() => {
        const vals = crossings.map((c) => Number(c.valueUsd ?? 0)).sort((a, b) => a - b);
        return vals[Math.floor(vals.length / 2)];
      })();
      result.proposed.push({
        id: newId("sug"),
        kind: "lower_daily_cap",
        value: Math.ceil(median),
        rationale: `${crossings.length} episodes exceeded your $${dailyCap} daily cap. Median crossing value was $${median.toFixed(2)}.`,
        confidence: 0.5,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return result;
}

function dedupePending(existing: Suggestion[], incoming: Suggestion[]): Suggestion[] {
  const key = (s: Suggestion) => `${s.kind}:${JSON.stringify(s.value)}`;
  const seen = new Set(existing.map(key));
  const merged = [...existing];
  for (const s of incoming) {
    if (seen.has(key(s))) continue;
    merged.push(s);
    seen.add(key(s));
  }
  // Cap at 20 most recent so this never grows unbounded.
  return merged.slice(-20);
}

export const dacsPolicyDerivation = inngest.createFunction(
  {
    id: "dacs-policy-derivation",
    name: "DACS · Nightly Policy Derivation",
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    if (!db) return { skipped: true, reason: "db_not_configured" };

    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const episodes = await step.run("load-episodes", async () =>
      db!
        .select()
        .from(agentEpisodes)
        .where(and(gte(agentEpisodes.createdAt, since), isNotNull(agentEpisodes.walletAddress)))
        .orderBy(desc(agentEpisodes.createdAt))
        .limit(5000),
    );

    if (episodes.length === 0) {
      return { processed: 0, autoAppliedTotal: 0, proposedTotal: 0 };
    }

    // Group by wallet.
    const byWallet = new Map<string, typeof episodes>();
    for (const ep of episodes) {
      if (!ep.walletAddress) continue;
      const arr = byWallet.get(ep.walletAddress) ?? [];
      arr.push(ep);
      byWallet.set(ep.walletAddress, arr);
    }

    let autoAppliedTotal = 0;
    let proposedTotal = 0;
    let walletsTouched = 0;

    for (const [walletAddress, walletEpisodes] of byWallet) {
      // Each wallet runs as its own step so retries don't reprocess all wallets.
      const summary = await step.run(`derive-${walletAddress.slice(0, 8)}`, async () => {
        const [policy] = await db!
          .select()
          .from(userAgentPolicy)
          .where(eq(userAgentPolicy.walletAddress, walletAddress))
          .limit(1);

        // No policy row yet → conservative defaults; only auto-apply if user
        // hasn't actively opted in. Skip until they touch settings once.
        if (!policy) return { autoApplied: 0, proposed: 0 };

        const result = derive(policy as PolicyRow, walletEpisodes as unknown as EpisodeRow[]);
        const existingPending = asSuggestions((policy as PolicyRow).pendingSuggestions);

        const newAllowlist = new Set(asArray((policy as PolicyRow).protocolAllowlist));
        for (const s of result.autoApplied) {
          if (s.kind === "add_protocol_allowlist" && typeof s.value === "string") {
            newAllowlist.add(s.value);
          }
        }

        const mergedPending = dedupePending(existingPending, result.proposed);

        await db!
          .update(userAgentPolicy)
          .set({
            protocolAllowlist: Array.from(newAllowlist),
            pendingSuggestions: mergedPending,
            lastDerivationAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(userAgentPolicy.walletAddress, walletAddress));

        return {
          autoApplied: result.autoApplied.length,
          proposed: result.proposed.length,
        };
      });

      autoAppliedTotal += summary.autoApplied;
      proposedTotal += summary.proposed;
      if (summary.autoApplied + summary.proposed > 0) walletsTouched += 1;
    }

    return {
      processed: byWallet.size,
      walletsTouched,
      autoAppliedTotal,
      proposedTotal,
    };
  },
);

// drizzle eq import kept inline to avoid touching the top of file too much.
import { eq } from "drizzle-orm";
