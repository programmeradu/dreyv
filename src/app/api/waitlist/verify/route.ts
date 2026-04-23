import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { waitlistEntries } from "@/db/schema";
import { checkDatabaseAvailability } from "@/lib/db-utils";

export const runtime = "nodejs";

/**
 * GET  /api/waitlist/verify?token=...
 *   Returns { ok, valid, expired, status, email? } so the /auth page can
 *   decide whether to allow signup with this invite.
 *
 * POST /api/waitlist/verify
 *   Body: { token, userId? } — marks the waitlist entry as `onboarded`,
 *   clears the token. Called by the /auth page after successful signup.
 */
export async function GET(request: NextRequest) {
  try {
    const dbCheck = checkDatabaseAvailability();
    if (dbCheck) return dbCheck;

    const token = request.nextUrl.searchParams.get("token") || "";
    if (!token || token.length < 16) {
      return NextResponse.json({ ok: true, valid: false, reason: "missing_token" });
    }

    const [row] = await db!
      .select({
        id: waitlistEntries.id,
        email: waitlistEntries.email,
        status: waitlistEntries.status,
        inviteExpiresAt: waitlistEntries.inviteExpiresAt,
      })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.inviteToken, token))
      .limit(1);

    if (!row) return NextResponse.json({ ok: true, valid: false, reason: "not_found" });
    const expired = row.inviteExpiresAt ? row.inviteExpiresAt.getTime() < Date.now() : false;

    return NextResponse.json({
      ok: true,
      valid: !expired && row.status === "invited",
      expired,
      status: row.status,
      email: row.email,
    });
  } catch (err) {
    console.error("[waitlist/verify GET] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const dbCheck = checkDatabaseAvailability();
    if (dbCheck) return dbCheck;

    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const [row] = await db!
      .select({
        id: waitlistEntries.id,
        status: waitlistEntries.status,
        inviteExpiresAt: waitlistEntries.inviteExpiresAt,
      })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.inviteToken, token))
      .limit(1);

    if (!row) return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    if (row.inviteExpiresAt && row.inviteExpiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    }
    if (row.status === "onboarded") {
      return NextResponse.json({ ok: true, alreadyOnboarded: true });
    }

    await db!
      .update(waitlistEntries)
      .set({
        status: "onboarded",
        onboardedAt: new Date(),
        inviteToken: null,
        updatedAt: new Date(),
      })
      .where(eq(waitlistEntries.id, row.id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[waitlist/verify POST] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
