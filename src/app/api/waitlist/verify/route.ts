export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { db } from "@/db";
import { users, waitlistEntries } from "@/db/schema";
import { checkDatabaseAvailability } from "@/lib/db-utils";


const INVITE_ALLOW_COOKIE = "dreyv-invite-allow";
const INVITE_ALLOW_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be configured");
  return new TextEncoder().encode(secret);
}

async function setInviteAllowCookie(response: NextResponse, email: string) {
  const token = await new SignJWT({ email: email.toLowerCase(), purpose: "waitlist-app-access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${INVITE_ALLOW_MAX_AGE}s`)
    .setIssuer("keystone-treasury-os")
    .sign(getJwtSecret());

  response.cookies.set(INVITE_ALLOW_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    partitioned: true,
    path: "/",
    maxAge: INVITE_ALLOW_MAX_AGE,
  });
}

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

    const response = NextResponse.json({
      ok: true,
      valid: !expired && row.status === "invited",
      expired,
      status: row.status,
      email: row.email,
    });

    if (!expired && row.status === "invited") {
      await setInviteAllowCookie(response, row.email);
    }

    return response;
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
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!token || token.length < 16) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
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

    if (!row) return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    if (row.inviteExpiresAt && row.inviteExpiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    }
    if (row.status === "onboarded") {
      const response = NextResponse.json({ ok: true, alreadyOnboarded: true });
      await setInviteAllowCookie(response, row.email);
      return response;
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

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      await db!
        .update(users)
        .set({ email: row.email, lastLoginAt: new Date() })
        .where(eq(users.id, userId));
    }

    const response = NextResponse.json({ ok: true });
    await setInviteAllowCookie(response, row.email);
    return response;
  } catch (err) {
    console.error("[waitlist/verify POST] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
