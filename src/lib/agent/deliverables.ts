/**
 * Agent deliverables — the user-visible side of an autonomous agent payment.
 *
 * One call per /api/x402/pay settlement. We:
 *  1. Run the SKU's fulfilment work inline (snapshot, AI report, tier upgrade).
 *  2. Persist the structured result to `agent_deliverables` so it has a
 *     permanent permalink at /app/agent/deliverables/[id].
 *  3. Fire a branded post-payment email to the API-key owner (best-effort —
 *     email failure never breaks the payment response).
 *
 * Receipt-token redemption against /api/x402/fulfil/* still works for
 * back-compat. The deliverable is the new primary surface.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { agentApiKeys, agentDeliverables, users } from "@/db/schema";
import { buildLiveVaultSnapshot, type LiveVaultSnapshot } from "@/lib/benchmark/vault-live";
import {
    sendAgentDeliverableEmail,
    sendSubscriptionActivatedEmail,
} from "@/lib/email-service";

const APP =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://dreyv.com";

export type DeliverableKind = "snapshot" | "report" | "subscription";

interface BaseArgs {
    paymentId: string;
    userId: string;
    apiKeyId: string;
    sku: string;
    amountUsdc: string; // formatted, e.g. "0.10"
    paidAtIso: string;  // ISO string, formatted for display
}

interface WalletArgs extends BaseArgs {
    kind: "snapshot" | "report";
    targetWallet: string;
}

interface SubscriptionArgs extends BaseArgs {
    kind: "subscription";
    tier: "mini" | "max";
    renewalAt: Date;
}

type CreateArgs = WalletArgs | SubscriptionArgs;

const STABLES = new Set(["USDC", "USDT", "PYUSD", "USDS", "DAI", "USDH", "USDR"]);

function fmtUsd(n: number): string {
    if (!Number.isFinite(n)) return "$0.00";
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
    return `${(n * 100).toFixed(1)}%`;
}

function truncateMiddle(s: string, head = 6, tail = 6): string {
    if (s.length <= head + tail + 3) return s;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function fmtDate(d: Date | string): string {
    const x = typeof d === "string" ? new Date(d) : d;
    return x.toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "UTC",
    }) + " UTC";
}

function computeSnapshotSummary(snap: LiveVaultSnapshot) {
    const valued = snap.holdings.filter((h) => (h.usd ?? 0) > 0);
    const total = valued.reduce((s, h) => s + (h.usd ?? 0), 0);
    const stable = valued
        .filter((h) => STABLES.has((h.symbol || "").toUpperCase()))
        .reduce((s, h) => s + (h.usd ?? 0), 0);
    const top = valued[0];
    const hhi = total > 0
        ? valued.reduce((acc, h) => {
            const share = ((h.usd ?? 0) / total) * 100;
            return acc + share * share;
        }, 0)
        : 0;
    return {
        totalUsd: total,
        stableUsd: stable,
        stableShare: total > 0 ? stable / total : 0,
        topSymbol: top?.symbol ?? null,
        topShare: total > 0 && top?.usd ? top.usd / total : 0,
        holdings: valued.length,
        hhi: Math.round(hhi),
    };
}

function summaryStatsForEmail(
    kind: "snapshot" | "report",
    summary: ReturnType<typeof computeSnapshotSummary>,
): { label: string; value: string }[] {
    if (kind === "snapshot") {
        return [
            { label: "Total value", value: fmtUsd(summary.totalUsd) },
            { label: "Stable share", value: fmtPct(summary.stableShare) },
            { label: "Holdings", value: String(summary.holdings) },
        ];
    }
    return [
        { label: "Total value", value: fmtUsd(summary.totalUsd) },
        { label: "Top", value: summary.topSymbol ? `${summary.topSymbol} · ${fmtPct(summary.topShare)}` : "—" },
        { label: "HHI", value: String(summary.hhi) },
    ];
}

interface CreateResult {
    deliverableId: string;
    viewUrl: string;
    pdfUrl: string | null;
    kind: DeliverableKind;
    summary: Record<string, unknown>;
    emailed: boolean;
}

/**
 * Main entry. Fire-and-await — caller already responded to the agent
 * with the receipt; we just need to land the deliverable + email.
 * Throws only on hard programming errors; all I/O is caught and surfaced
 * via the row's `error` / `email_error` columns.
 */
export async function createDeliverable(args: CreateArgs): Promise<CreateResult> {
    if (!db) throw new Error("db_unavailable");

    // 0. Resolve the recipient email + the agent key label up front so we
    //    have them in scope no matter which branch we take.
    const [owner] = await db
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, args.userId))
        .limit(1);
    const [keyRow] = await db
        .select({ label: agentApiKeys.label })
        .from(agentApiKeys)
        .where(eq(agentApiKeys.id, args.apiKeyId))
        .limit(1);
    const recipientEmail = owner?.email ?? null;
    const agentKeyLabel = keyRow?.label ?? "(unnamed agent key)";

    // 1. Insert a `generating` row immediately so a crash leaves an audit trail.
    const [row] = await db
        .insert(agentDeliverables)
        .values({
            paymentId: args.paymentId,
            userId: args.userId,
            apiKeyId: args.apiKeyId,
            kind: args.kind,
            sku: args.sku,
            targetWallet: args.kind === "subscription" ? null : args.targetWallet,
            status: "generating",
            emailTo: recipientEmail,
        })
        .returning({ id: agentDeliverables.id });
    const deliverableId = row.id;
    const viewUrl = `${APP}/app/agent/deliverables/${deliverableId}`;

    // 2. Branch on kind to actually produce the deliverable.
    let summary: Record<string, unknown> = {};
    let payload: Record<string, unknown> = {};
    try {
        if (args.kind === "snapshot") {
            const snap = await buildLiveVaultSnapshot(args.targetWallet);
            const s = computeSnapshotSummary(snap);
            summary = s as unknown as Record<string, unknown>;
            payload = { snapshot: snap };
        } else if (args.kind === "report") {
            const snap = await buildLiveVaultSnapshot(args.targetWallet);
            const s = computeSnapshotSummary(snap);
            summary = s as unknown as Record<string, unknown>;
            payload = { snapshot: snap };
            // The AI narrative is rendered on-demand from the snapshot via
            // existing /api/x402/fulfil/treasury-report when the user opens
            // the view page — keeps this path < 60s for big wallets.
        } else if (args.kind === "subscription") {
            summary = {
                tier: args.tier,
                renewalAt: args.renewalAt.toISOString(),
            };
            payload = {
                tier: args.tier,
                renewalAt: args.renewalAt.toISOString(),
                manageUrl: `${APP}/app/settings/billing`,
            };
        }


        await db
            .update(agentDeliverables)
            .set({
                status: "ready",
                summary: summary as never,
                payload: payload as never,
                readyAt: new Date(),
            })
            .where(eq(agentDeliverables.id, deliverableId));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[deliverables ${deliverableId}] generation failed:`, message);
        await db
            .update(agentDeliverables)
            .set({ status: "failed", error: message })
            .where(eq(agentDeliverables.id, deliverableId));
        return {
            deliverableId,
            viewUrl,
            pdfUrl: null,
            kind: args.kind,
            summary: {},
            emailed: false,
        };
    }

    // 3. Email — best-effort, never throws.
    let emailed = false;
    if (recipientEmail) {
        try {
            const sent = await (async () => {
                if (args.kind === "subscription") {
                    return sendSubscriptionActivatedEmail(recipientEmail, {
                        tier: args.tier,
                        renewalDate: fmtDate(args.renewalAt),
                        agentKeyLabel,
                        amountUsdc: args.amountUsdc,
                        manageUrl: `${APP}/app/settings/billing`,
                    });
                }
                const stats = summaryStatsForEmail(
                    args.kind,
                    summary as ReturnType<typeof computeSnapshotSummary>,
                );
                return sendAgentDeliverableEmail(recipientEmail, {
                    kind: args.kind,
                    skuName: args.kind === "snapshot" ? "Treasury Snapshot" : "Treasury AI Report",
                    targetWallet: truncateMiddle(args.targetWallet, 8, 8),
                    agentKeyLabel,
                    amountUsdc: args.amountUsdc,
                    stats,
                    viewUrl,
                    pdfUrl: null,
                    paidAt: fmtDate(args.paidAtIso),
                });
            })();
            if (sent.success) {
                emailed = true;
                await db
                    .update(agentDeliverables)
                    .set({ emailSentAt: new Date(), emailMessageId: sent.id ?? null })
                    .where(eq(agentDeliverables.id, deliverableId));
            } else {
                await db
                    .update(agentDeliverables)
                    .set({ emailError: sent.error ?? "send_failed" })
                    .where(eq(agentDeliverables.id, deliverableId));
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[deliverables ${deliverableId}] email failed:`, message);
            await db
                .update(agentDeliverables)
                .set({ emailError: message })
                .where(eq(agentDeliverables.id, deliverableId));
        }
    }

    return {
        deliverableId,
        viewUrl,
        pdfUrl: null,
        kind: args.kind,
        summary,
        emailed,
    };
}

/**
 * Re-send the email for an existing deliverable. Used by the dashboard
 * row-level "Resend email" action. Rate-limit is enforced at the API
 * route, not here.
 */
export async function resendDeliverableEmail(deliverableId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    if (!db) return { success: false, error: "db_unavailable" };
    const [row] = await db
        .select()
        .from(agentDeliverables)
        .where(and(eq(agentDeliverables.id, deliverableId), eq(agentDeliverables.userId, userId)))
        .limit(1);
    if (!row) return { success: false, error: "not_found" };
    if (row.status !== "ready") return { success: false, error: "not_ready" };
    if (!row.emailTo) return { success: false, error: "no_email_on_account" };

    const [keyRow] = await db
        .select({ label: agentApiKeys.label })
        .from(agentApiKeys)
        .where(eq(agentApiKeys.id, row.apiKeyId))
        .limit(1);
    const agentKeyLabel = keyRow?.label ?? "(unnamed agent key)";
    const viewUrl = `${APP}/app/agent/deliverables/${row.id}`;

    let result: Awaited<ReturnType<typeof sendAgentDeliverableEmail>>;
    if (row.kind === "subscription") {
        const payload = row.payload as { tier?: "mini" | "max"; renewalAt?: string; manageUrl?: string };
        if (!payload?.tier || !payload?.renewalAt) {
            return { success: false, error: "bad_payload" };
        }
        result = await sendSubscriptionActivatedEmail(row.emailTo, {
            tier: payload.tier,
            renewalDate: fmtDate(payload.renewalAt),
            agentKeyLabel,
            amountUsdc: "—",
            manageUrl: payload.manageUrl ?? `${APP}/app/settings/billing`,
        });
    } else {
        const summary = row.summary as ReturnType<typeof computeSnapshotSummary>;
        result = await sendAgentDeliverableEmail(row.emailTo, {
            kind: row.kind as "snapshot" | "report",
            skuName: row.kind === "snapshot" ? "Treasury Snapshot" : "Treasury AI Report",
            targetWallet: truncateMiddle(row.targetWallet ?? "", 8, 8),
            agentKeyLabel,
            amountUsdc: "—",
            stats: summaryStatsForEmail(row.kind as "snapshot" | "report", summary),
            viewUrl,
            pdfUrl: row.pdfUrl ?? null,
            paidAt: fmtDate(row.createdAt),
        });
    }
    if (result.success) {
        await db
            .update(agentDeliverables)
            .set({ emailSentAt: new Date(), emailMessageId: result.id ?? null, emailError: null })
            .where(eq(agentDeliverables.id, row.id));
        return { success: true };
    }
    await db
        .update(agentDeliverables)
        .set({ emailError: result.error ?? "send_failed" })
        .where(eq(agentDeliverables.id, row.id));
    return { success: false, error: result.error };
}
