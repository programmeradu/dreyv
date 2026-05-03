import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { waitlistEntries } from "@/db/schema";
import { checkDatabaseAvailability } from "@/lib/db-utils";

export const runtime = "nodejs";

/**
 * GET /api/internal/waitlist-allowed?email=...
 *
 * Returns `{ allowed: boolean }` — true if the email exists in
 * `waitlist_entries` with status `invited` or `onboarded`.
 *
 * Used by middleware (construction gate) to auto-allow accepted invitees
 * without env-var maintenance. Protected by `X-Internal-Secret` header
 * (shared with middleware via JWT_SECRET — we already trust it for SIWS).
 */
export async function GET(request: NextRequest) {
  try {
    const secret = request.headers.get("x-internal-secret") || "";
    const expected = process.env.JWT_SECRET || "";
    if (!expected || secret !== expected) {
      return NextResponse.json({ allowed: false }, { status: 401 });
    }

    const dbCheck = checkDatabaseAvailability();
    if (dbCheck) return NextResponse.json({ allowed: false });

    const email = (request.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
    if (!email || email.length > 320 || !email.includes("@")) {
      return NextResponse.json({ allowed: false });
    }

    const [row] = await db!
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.email, email),
          inArray(waitlistEntries.status, ["invited", "onboarded"]),
        ),
      )
      .limit(1);

    return NextResponse.json(
      { allowed: !!row },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (err) {
    console.error("[internal/waitlist-allowed] error:", err);
    return NextResponse.json({ allowed: false }, { status: 500 });
  }
}
