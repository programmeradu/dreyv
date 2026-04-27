/**
 * Phase 7B.4 — Grant milestone proof verifiers.
 *
 * Each proof type returns `{ verified: boolean, evidence?, error? }`.
 *  - github_pr: PR merged via Octokit (anonymous reads work for public repos;
 *    authenticated when GITHUB_TOKEN is set — higher rate limit + private repos).
 *  - onchain_event: scans recent program signatures for a log line containing
 *    the event name (lightweight; deeper Anchor decoding is overkill at this
 *    layer). Uses Helius RPC.
 *  - manual_attestation: not auto-verifiable; always returns `{ verified: false,
 *    error: 'manual' }` — funder releases via `grant_milestone_release` directly.
 */
import { Octokit } from "@octokit/rest";

export type ProofSpec =
  | { type: "github_pr"; repo: string; prNumber: number }
  | { type: "onchain_event"; program: string; eventName: string }
  | { type: "manual_attestation"; attesters: string[] };

export interface ProofResult {
  verified: boolean;
  evidence?: Record<string, unknown>;
  error?: string;
}

let _octokit: Octokit | null = null;
function getOctokit(): Octokit {
  if (_octokit) return _octokit;
  _octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
    userAgent: "dreyv-grants/1.0",
  });
  return _octokit;
}

function parseRepo(repo: string): { owner: string; name: string } | null {
  // Accept "owner/name" or full URL
  const cleaned = repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], name: parts[1] };
}

export async function verifyGithubPr(repo: string, prNumber: number): Promise<ProofResult> {
  const parsed = parseRepo(repo);
  if (!parsed) return { verified: false, error: `Invalid repo '${repo}' — expected 'owner/name'` };
  try {
    const octokit = getOctokit();
    const { data } = await octokit.rest.pulls.get({
      owner: parsed.owner,
      repo: parsed.name,
      pull_number: prNumber,
    });
    if (data.merged) {
      return {
        verified: true,
        evidence: {
          mergedAt: data.merged_at,
          mergedBy: data.merged_by?.login,
          mergeCommitSha: data.merge_commit_sha,
          title: data.title,
          author: data.user?.login,
          additions: data.additions,
          deletions: data.deletions,
          url: data.html_url,
        },
      };
    }
    return {
      verified: false,
      evidence: { state: data.state, draft: data.draft, title: data.title, url: data.html_url },
      error: data.state === "closed" ? "PR closed without merge" : "PR not merged yet",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|404/i.test(msg)) return { verified: false, error: `PR #${prNumber} not found in ${parsed.owner}/${parsed.name}` };
    if (/rate limit/i.test(msg)) return { verified: false, error: "GitHub rate-limited; will retry next tick" };
    return { verified: false, error: msg };
  }
}

export async function verifyOnchainEvent(program: string, eventName: string): Promise<ProofResult> {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  try {
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const conn = new Connection(rpcUrl, "confirmed");
    const programKey = new PublicKey(program);
    const sigs = await conn.getSignaturesForAddress(programKey, { limit: 25 });
    for (const s of sigs) {
      if (s.err) continue;
      const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages ?? [];
      const hit = logs.find((l) => l.toLowerCase().includes(eventName.toLowerCase()));
      if (hit) {
        return {
          verified: true,
          evidence: { signature: s.signature, slot: s.slot, blockTime: s.blockTime, logLine: hit },
        };
      }
    }
    return { verified: false, error: `Event '${eventName}' not found in last 25 ${program.slice(0, 8)}… txs` };
  } catch (err) {
    return { verified: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function verifyProof(proof: ProofSpec): Promise<ProofResult> {
  switch (proof.type) {
    case "github_pr":
      return verifyGithubPr(proof.repo, proof.prNumber);
    case "onchain_event":
      return verifyOnchainEvent(proof.program, proof.eventName);
    case "manual_attestation":
      return { verified: false, error: "manual" };
  }
}
