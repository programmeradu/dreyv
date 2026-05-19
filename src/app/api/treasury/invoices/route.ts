/**
 * /api/treasury/invoices — invoice inbox per vault.
 *
 *   GET   ?wallet=…&status=pending  list invoices
 *   POST  { wallet, vendorName, payToAddress, amount, token?, memo?, dueAt? }
 *   PATCH { id, action: 'pay'|'reject'|'edit', ...patch }
 *   DELETE?id=…                      remove
 *
 * `pay` enqueues a HITL tx proposal and links it back via tx_proposal_id.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { treasuryInvoices } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { resolveUserIdFromWallet, insertTxProposal } from "@/lib/agents/brains/storage";
import { getAuthUser } from "@/lib/auth-utils";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  const status = url.searchParams.get("status");
  if (!wallet) return NextResponse.json({ ok: true, invoices: [] });
  const where = status
    ? and(eq(treasuryInvoices.vaultAddress, wallet), eq(treasuryInvoices.status, status))
    : eq(treasuryInvoices.vaultAddress, wallet);
  const rows = await db.select().from(treasuryInvoices).where(where).orderBy(desc(treasuryInvoices.createdAt)).limit(100);
  return NextResponse.json({ ok: true, invoices: rows });
}

export async function POST(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { wallet, vendorName, payToAddress, amount, token = "USDC", memo = null, dueAt = null } = body ?? {};
  if (!wallet || !vendorName || !payToAddress || !(Number(amount) > 0)) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }
  const userId = await resolveUserIdFromWallet(wallet);
  const [row] = await db.insert(treasuryInvoices).values({
    userId, vaultAddress: wallet,
    vendorName: String(vendorName),
    payToAddress: String(payToAddress),
    amount: String(amount),
    token: String(token).toUpperCase(),
    memo: memo ? String(memo) : null,
    dueAt: dueAt ? new Date(dueAt) : null,
    status: "pending",
  }).returning();
  return NextResponse.json({ ok: true, invoice: row });
}

export async function PATCH(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { id, action } = body ?? {};
  if (!id || !action) return NextResponse.json({ ok: false, error: "id_action_required" }, { status: 400 });
  const [existing] = await db.select().from(treasuryInvoices).where(eq(treasuryInvoices.id, id)).limit(1);
  if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  if (action === "reject") {
    await db.update(treasuryInvoices).set({ status: "rejected", updatedAt: new Date() }).where(eq(treasuryInvoices.id, id));
    return NextResponse.json({ ok: true });
  }
  if (action === "pay") {
    const tx = await insertTxProposal({
      userId: existing.userId,
      kind: "transfer",
      summary: `Invoice · ${existing.vendorName} · ${existing.amount} ${existing.token}`,
      instructions: [{
        type: "transfer",
        from: existing.vaultAddress,
        to: existing.payToAddress,
        amount: Number(existing.amount),
        token: existing.token,
        memo: existing.memo ?? `Invoice ${existing.vendorName}`,
      }],
      riskLevel: Number(existing.amount) > 5000 ? "high" : "medium",
      routing: "wallet",
      meta: { source: "invoice", invoiceId: id, vendor: existing.vendorName },
      ttlMinutes: 120,
    });
    await db.update(treasuryInvoices).set({
      status: "queued",
      txProposalId: tx?.id ?? null,
      updatedAt: new Date(),
    }).where(eq(treasuryInvoices.id, id));
    return NextResponse.json({ ok: true, txProposalId: tx?.id ?? null });
  }
  if (action === "edit") {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.vendorName === "string") patch.vendorName = body.vendorName;
    if (typeof body.payToAddress === "string") patch.payToAddress = body.payToAddress;
    if (Number(body.amount) > 0) patch.amount = String(body.amount);
    if (typeof body.token === "string") patch.token = body.token.toUpperCase();
    if (typeof body.memo === "string") patch.memo = body.memo;
    if (body.dueAt) patch.dueAt = new Date(body.dueAt);
    await db.update(treasuryInvoices).set(patch).where(eq(treasuryInvoices.id, id));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  /* __AUTH_GUARD__ */
  const _authUser = await getAuthUser(req as unknown as NextRequest);
  if (!_authUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  await db.delete(treasuryInvoices).where(eq(treasuryInvoices.id, id));
  return NextResponse.json({ ok: true });
}
