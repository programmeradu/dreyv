/**
 * Phase 7A — Treasury report data builder.
 *
 * Pulls the raw inputs needed for `treasury_report_pdf` / `treasury_report_csv`
 * from real sources:
 *   - On-chain transactions  → Helius enhanced tx (`./helius`)
 *   - Multisig proposals     → DB `agent_proposals` filtered by month + wallet
 *   - Policy actions         → DB `agent_episodes` filtered by month + wallet
 *
 * No mock data. Returns empty arrays when the sources are empty.
 */

import { db } from "@/db";
import { agentEpisodes, agentProposals } from "@/db/schema";
import { and, gte, lte, eq, desc } from "drizzle-orm";
import { fetchHeliusTransactions, monthRange, type HeliusEnhancedTx } from "./helius";
import type { ProposalRow, TransactionRow, PolicyActionRow, TreasuryReportInput } from "./pdf";

const SOL_DECIMALS = 9;

export interface BuildReportOpts {
    walletOrVault: string;
    /** "YYYY-MM" */
    month: string;
    userId?: string | null;
    /** Optional SOL spot price (USD) for native-transfer valuation. */
    solPriceUsd?: number | null;
}

export async function buildTreasuryReportData(opts: BuildReportOpts): Promise<TreasuryReportInput> {
    const { walletOrVault, month, userId, solPriceUsd } = opts;
    const { since, until, label } = monthRange(month);

    // 1) On-chain txs (real Helius call). Throws if HELIUS_API_KEY missing.
    let heliusTxs: HeliusEnhancedTx[] = [];
    try {
        heliusTxs = await fetchHeliusTransactions(walletOrVault, {
            sinceUnix: since,
            untilUnix: until,
            limit: 1000,
        });
    } catch (e) {
        // Re-throw so the capability surfaces a real failure rather than fake data.
        throw new Error(`On-chain history fetch failed: ${(e as Error).message}`);
    }

    const transactions: TransactionRow[] = [];
    let netFlowUsd = 0;
    let nativeFlowsKnown = false;

    for (const tx of heliusTxs) {
        const date = new Date(tx.timestamp * 1000).toISOString().slice(0, 10);

        for (const nt of tx.nativeTransfers ?? []) {
            const sol = nt.amount / 10 ** SOL_DECIMALS;
            const direction: TransactionRow["direction"] =
                nt.fromUserAccount === walletOrVault ? "out"
                    : nt.toUserAccount === walletOrVault ? "in"
                        : "internal";
            const usd = solPriceUsd != null ? sol * solPriceUsd * (direction === "out" ? -1 : 1) : null;
            if (usd != null) {
                nativeFlowsKnown = true;
                netFlowUsd += usd;
            }
            transactions.push({
                date,
                signature: tx.signature,
                direction,
                token: "SOL",
                amount: sol,
                valueUsd: usd,
                counterparty: direction === "out" ? nt.toUserAccount : nt.fromUserAccount,
            });
        }

        for (const tt of tx.tokenTransfers ?? []) {
            const direction: TransactionRow["direction"] =
                tt.fromUserAccount === walletOrVault ? "out"
                    : tt.toUserAccount === walletOrVault ? "in"
                        : "internal";
            transactions.push({
                date,
                signature: tx.signature,
                direction,
                token: tt.mint.slice(0, 6),    // short mint; UI can re-resolve symbol
                amount: tt.tokenAmount,
                valueUsd: null,                  // SPL price resolution would require Jupiter/CG; skipped to stay real
                counterparty: direction === "out" ? tt.toUserAccount : tt.fromUserAccount,
            });
        }
    }

    // 2) Proposals (real DB query).
    const proposalRows = userId
        ? await db
            .select()
            .from(agentProposals)
            .where(
                and(
                    eq(agentProposals.userId, userId),
                    gte(agentProposals.createdAt, new Date(since * 1000)),
                    lte(agentProposals.createdAt, new Date(until * 1000)),
                ),
            )
            .orderBy(desc(agentProposals.createdAt))
        : [];

    const proposals: ProposalRow[] = proposalRows.map((p) => ({
        date: p.createdAt.toISOString().slice(0, 10),
        title: p.title,
        type: p.kind,
        status: p.status,
        quorum: undefined,
        valueUsd: null,
        signature: null,
    }));

    // 3) Policy / agent decisions for this wallet (real DB query).
    const episodeRows = await db
        .select()
        .from(agentEpisodes)
        .where(
            and(
                eq(agentEpisodes.walletAddress, walletOrVault),
                gte(agentEpisodes.createdAt, new Date(since * 1000)),
                lte(agentEpisodes.createdAt, new Date(until * 1000)),
            ),
        )
        .orderBy(desc(agentEpisodes.createdAt));

    const policyActions: PolicyActionRow[] = episodeRows.map((e) => ({
        date: e.createdAt.toISOString().slice(0, 10),
        capability: Array.isArray(e.capabilityIds) ? (e.capabilityIds as string[]).join(",") : "—",
        decision: e.outcome,
        riskScore: e.riskScore != null ? Number(e.riskScore) : null,
        notes: e.notes ?? null,
    }));

    return {
        walletOrVault,
        period: label,
        generatedAt: new Date().toISOString(),
        summary: {
            totalProposals: proposals.length,
            executedProposals: proposals.filter((p) => p.status === "acted").length,
            totalTransactions: transactions.length,
            netFlowUsd: nativeFlowsKnown ? netFlowUsd : null,
            startingBalanceUsd: null,
            endingBalanceUsd: null,
        },
        proposals,
        transactions,
        policyActions,
    };
}
