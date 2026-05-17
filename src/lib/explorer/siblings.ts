/**
 * Sibling-wallet heuristic. Cheap and conservative — never reports a
 * sibling without at least one strong signal.
 *  - shared first funder (within first 5 inbound native txs)
 *  - co-signer on same Squads multisig
 */

import { getEnhancedTransactions } from "./helius-tx";
import { lookupSolanaLabel } from "./labels";
import { getSiteOrigin } from "@/lib/seo/site";

export interface Sibling {
  address: string;
  confidence: number;
  reasons: string[];
}

export async function findSiblings(address: string): Promise<Sibling[]> {
  const txs = await getEnhancedTransactions(address, 100);
  const inbound = txs
    .filter((t) => (t.nativeTransfers ?? []).some((nt) => nt.toUserAccount === address))
    .slice(-5);
  const funders = new Set<string>();
  for (const t of inbound) {
    for (const nt of t.nativeTransfers ?? []) {
      if (nt.toUserAccount === address && nt.fromUserAccount && nt.fromUserAccount !== address) {
        if (lookupSolanaLabel(nt.fromUserAccount)?.category !== "cex") funders.add(nt.fromUserAccount);
      }
    }
  }

  const siblings: Sibling[] = [];

  // Pull other receivers funded by the same source (best-effort, single hop).
  for (const funder of funders) {
    const funderTxs = await getEnhancedTransactions(funder, 50);
    const receivers = new Set<string>();
    for (const t of funderTxs) {
      for (const nt of t.nativeTransfers ?? []) {
        if (nt.fromUserAccount === funder && nt.toUserAccount && nt.toUserAccount !== address) {
          receivers.add(nt.toUserAccount);
        }
      }
    }
    for (const r of receivers) {
      if (lookupSolanaLabel(r)?.category) continue;
      siblings.push({ address: r, confidence: 0.6, reasons: ["Same funder"] });
    }
  }

  // Multisig co-signers via the security route
  try {
    const base = getSiteOrigin();
    const r = await fetch(`${base}/api/treasury/security?wallet=${address}&public=1`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const signers: Array<{ address: string }> = j?.audit?.signers ?? [];
      for (const s of signers) {
        if (s.address && s.address !== address) {
          const exist = siblings.find((x) => x.address === s.address);
          if (exist) {
            exist.confidence = Math.min(1, exist.confidence + 0.3);
            exist.reasons.push("Multisig co-signer");
          } else {
            siblings.push({ address: s.address, confidence: 0.8, reasons: ["Multisig co-signer"] });
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // Dedupe + cap
  const map = new Map<string, Sibling>();
  for (const s of siblings) {
    const cur = map.get(s.address);
    if (cur) {
      cur.confidence = Math.max(cur.confidence, s.confidence);
      cur.reasons = Array.from(new Set([...cur.reasons, ...s.reasons]));
    } else map.set(s.address, s);
  }
  return Array.from(map.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}
