/**
 * /api/treasury/reports — on-demand treasury reports + shareable links.
 *
 *   GET    ?wallet=…           list reports for the vault
 *   POST   { wallet, title?, snapshot? }   create a report (snapshot of current state)
 *   PATCH  { id, wallet, action: 'publish'|'revoke', expiresInDays? }
 *   DELETE ?id=…&wallet=…
 *
 *   GET    ?token=…            public read-only fetch (no auth) — only published+unrevoked
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { treasuryReports } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { resolveUserIdFromWallet } from "@/lib/agents/brains/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newToken() {
  return randomBytes(18).toString("base64url");
}

export async function GET(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token) {
    const [row] = await db.select().from(treasuryReports).where(eq(treasuryReports.shareToken, token)).limit(1);
    if (!row || row.status !== "published") return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    if (row.shareExpiresAt && row.shareExpiresAt < new Date()) {
      return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
    }
    // Public payload — strip user id
    return NextResponse.json({
      ok: true,
      report: {
        title: row.title,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        snapshot: row.snapshot,
        createdAt: row.createdAt,
        vaultAddress: row.vaultAddress,
      },
    });
  }
  const wallet = url.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ ok: true, reports: [] });
  const rows = await db.select().from(treasuryReports)
    .where(eq(treasuryReports.vaultAddress, wallet))
    .orderBy(desc(treasuryReports.createdAt));
  return NextResponse.json({ ok: true, reports: rows });
}

export async function POST(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { wallet, title, snapshot = {}, periodStart = null, periodEnd = null } = body ?? {};
  if (!wallet) return NextResponse.json({ ok: false, error: "wallet_required" }, { status: 400 });
  const userId = await resolveUserIdFromWallet(wallet);
  const finalTitle = title?.trim() || `Treasury report · ${new Date().toISOString().slice(0, 10)}`;
  const [row] = await db.insert(treasuryReports).values({
    userId, vaultAddress: wallet, title: finalTitle,
    periodStart: periodStart ? new Date(periodStart) : null,
    periodEnd: periodEnd ? new Date(periodEnd) : null,
    snapshot, status: "draft",
  }).returning();
  return NextResponse.json({ ok: true, report: row });
}

export async function PATCH(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const { id, wallet, action, expiresInDays = 30 } = body ?? {};
  if (!id || !wallet || !action) return NextResponse.json({ ok: false, error: "id_wallet_action_required" }, { status: 400 });
  const [existing] = await db.select().from(treasuryReports)
    .where(and(eq(treasuryReports.id, id), eq(treasuryReports.vaultAddress, wallet))).limit(1);
  if (!existing) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  if (action === "publish") {
    const expires = expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86400_000) : null;
    const token = existing.shareToken ?? newToken();
    const [row] = await db.update(treasuryReports).set({
      status: "published", shareToken: token, shareExpiresAt: expires, updatedAt: new Date(),
    }).where(eq(treasuryReports.id, id)).returning();
    return NextResponse.json({ ok: true, report: row });
  }
  if (action === "revoke") {
    const [row] = await db.update(treasuryReports).set({
      status: "revoked", shareToken: null, shareExpiresAt: null, updatedAt: new Date(),
    }).where(eq(treasuryReports.id, id)).returning();
    return NextResponse.json({ ok: true, report: row });
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 500 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const wallet = url.searchParams.get("wallet");
  if (!id || !wallet) return NextResponse.json({ ok: false, error: "id_wallet_required" }, { status: 400 });
  await db.delete(treasuryReports)
    .where(and(eq(treasuryReports.id, id), eq(treasuryReports.vaultAddress, wallet)));
  return NextResponse.json({ ok: true });
}
