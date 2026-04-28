/**
 * /api/treasury/recurring-payouts — payroll/grant schedules per vault.
 *
 *   GET   ?wallet=…             list active+paused schedules for that vault
 *   POST  { wallet, label, cadence, anchorDay?, defaultToken?, recipients[] }
 *   PATCH { id, action: 'pause'|'resume'|'archive'|'rename'|'queue-now', ... }
 *   DELETE?id=…                 hard delete
 *
 * `queue-now` enqueues the schedule's recipients into agent_tx_proposals
 * (HITL) without waiting for nextRunAt — used by the canvas "Run now" CTA.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { treasuryRecurringPayouts } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { resolveUserIdFromWallet, insertTxProposal } from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Recipient { address: string; amount: number; label?: string }

function nextRunFromCadence(cadence: string, anchorDay?: number | null): Date | null {
  const now = new Date();
  const d = new Date(now);
  if (cadence === "monthly") {
    const day = anchorDay ?? 1;
    d.setMonth(d.getMonth() + 1, day);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  if (cadence === "biweekly") {
    d.setDate(d.getDate() + 14);
    return d;
  }
  if (cadence === "weekly") {
    d.setDate(d.getDate() + 7);
    return d;
  }
  return null;
}

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ ok: true, schedules: [] });
  const rows = await db
    .select()
    .from(treasuryRecurringPayouts)
    .where(eq(treasuryRecurringPayouts.vaultAddress, wallet))
    .orderBy(desc(treasuryRecurringPayouts.createdAt))
    .limit(50);
  return NextResponse.json({ ok: true, schedules: rows });
}

export async function POST(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { wallet, label, cadence = "monthly", anchorDay = null, defaultToken = "USDC", recipients = [] } = body ?? {};
  if (!wallet || !label || !Array.isArray(recipients)) {
    return NextResponse.json({ ok: false, error: "wallet_label_recipients_required" }, { status: 400 });
  }
  const cleaned: Recipient[] = recipients
    .filter((r: any) => r?.address && Number(r.amount) > 0)
    .map((r: any) => ({ address: String(r.address), amount: Number(r.amount), label: r.label ? String(r.label) : undefined }));
  const userId = await resolveUserIdFromWallet(wallet);
  const [row] = await db.insert(treasuryRecurringPayouts).values({
    userId, vaultAddress: wallet, label: String(label), cadence, anchorDay,
    defaultToken: String(defaultToken).toUpperCase(),
    recipients: cleaned as unknown as object,
    status: "active",
    nextRunAt: nextRunFromCadence(cadence, anchorDay),
  }).returning();
  return NextResponse.json({ ok: true, schedule: row });
}

export async function PATCH(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { id, action } = body ?? {};
  if (!id || !action) return NextResponse.json({ ok: false, error: "id_action_required" }, { status: 400 });
  const [existing] = await db.select().from(treasuryRecurringPayouts).where(eq(treasuryRecurringPayouts.id, id)).limit(1);
  if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  if (action === "pause") {
    await db.update(treasuryRecurringPayouts).set({ status: "paused", updatedAt: new Date() }).where(eq(treasuryRecurringPayouts.id, id));
    return NextResponse.json({ ok: true });
  }
  if (action === "resume") {
    await db.update(treasuryRecurringPayouts).set({
      status: "active", updatedAt: new Date(),
      nextRunAt: nextRunFromCadence(existing.cadence, existing.anchorDay),
    }).where(eq(treasuryRecurringPayouts.id, id));
    return NextResponse.json({ ok: true });
  }
  if (action === "archive") {
    await db.update(treasuryRecurringPayouts).set({ status: "archived", updatedAt: new Date() }).where(eq(treasuryRecurringPayouts.id, id));
    return NextResponse.json({ ok: true });
  }
  if (action === "rename" && typeof body.label === "string") {
    await db.update(treasuryRecurringPayouts).set({ label: body.label, updatedAt: new Date() }).where(eq(treasuryRecurringPayouts.id, id));
    return NextResponse.json({ ok: true });
  }
  if (action === "queue-now") {
    const recipients = (existing.recipients as Recipient[]) ?? [];
    if (!recipients.length) return NextResponse.json({ ok: false, error: "no_recipients" }, { status: 400 });
    const total = recipients.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const tx = await insertTxProposal({
      userId: existing.userId,
      kind: "mass-send",
      summary: `${existing.label} · ${recipients.length} recipients · ${total} ${existing.defaultToken}`,
      instructions: recipients.map((r) => ({
        type: "transfer",
        from: existing.vaultAddress,
        to: r.address,
        amount: r.amount,
        token: existing.defaultToken,
        memo: r.label ?? `${existing.label} payout`,
      })),
      riskLevel: total > 5000 ? "high" : "medium",
      routing: "wallet",
      meta: { source: "recurring-payout", scheduleId: id, label: existing.label },
      ttlMinutes: 120,
    });
    await db.update(treasuryRecurringPayouts).set({
      lastRunAt: new Date(),
      nextRunAt: nextRunFromCadence(existing.cadence, existing.anchorDay),
      updatedAt: new Date(),
    }).where(eq(treasuryRecurringPayouts.id, id));
    return NextResponse.json({ ok: true, txProposalId: tx?.id ?? null });
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  await db.delete(treasuryRecurringPayouts).where(eq(treasuryRecurringPayouts.id, id));
  return NextResponse.json({ ok: true });
}
