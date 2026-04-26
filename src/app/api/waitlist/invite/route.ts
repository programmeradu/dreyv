import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { inArray, eq } from "drizzle-orm";
import { db } from "@/db";
import { waitlistEntries, users } from "@/db/schema";
import { checkDatabaseAvailability } from "@/lib/db-utils";
import { getAuthUser } from "@/lib/auth-utils";
import { sendWaitlistInviteEmail } from "@/lib/email-service";
import { INVITE_EXPIRY_DAYS } from "@/lib/waitlist/constants";

export const runtime = "nodejs";

async function isAdmin(userId: string): Promise<boolean> {
  if (!db) return false;
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.role === "admin";
}

function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://dreyv.com").replace(/\/+$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const dbCheck = checkDatabaseAvailability();
    if (dbCheck) return dbCheck;

    const auth = await getAuthUser(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(auth.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
    if (ids.length === 0 || ids.length > 100) {
      return NextResponse.json({ error: "Provide 1–100 entry ids" }, { status: 400 });
    }

    const rows = await db!
      .select()
      .from(waitlistEntries)
      .where(inArray(waitlistEntries.id, ids));

    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const baseUrl = getAppUrl();
    const results: Array<{ id: string; email: string; ok: boolean; error?: string; inviteUrl?: string }> = [];

    for (const row of rows) {
      try {
        const token = randomBytes(24).toString("base64url");
        await db!
          .update(waitlistEntries)
          .set({
            status: "invited",
            inviteToken: token,
            invitedAt: now,
            inviteExpiresAt: expiresAt,
            updatedAt: now,
          })
          .where(eq(waitlistEntries.id, row.id));

        const inviteUrl = `${baseUrl}/auth?invite=${token}`;
        results.push({ id: row.id, email: row.email, ok: true, inviteUrl });

        void (async () => {
          try {
            await sendWaitlistInviteEmail({
              to: row.email,
              name: row.name,
              inviteUrl,
              expiresInDays: INVITE_EXPIRY_DAYS,
            });
          } catch (err) {
            console.warn("[waitlist/invite] email failed:", (err as Error).message);
          }
        })();
      } catch (err) {
        results.push({ id: row.id, email: row.email, ok: false, error: (err as Error).message });
      }
    }

    return NextResponse.json({
      ok: true,
      invited: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    console.error("[waitlist/invite] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
