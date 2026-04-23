import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { waitlistEntries } from "@/db/schema";
import { checkDatabaseAvailability } from "@/lib/db-utils";
import { checkRouteLimit } from "@/lib/rate-limit-middleware";
import { waitlistSubmissionSchema } from "@/lib/waitlist/schema";
import { sendWaitlistConfirmationEmail } from "@/lib/email-service";

export const runtime = "nodejs";

function hashIp(req: NextRequest): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export async function POST(request: NextRequest) {
  try {
    const dbCheck = checkDatabaseAvailability();
    if (dbCheck) return dbCheck;

    const limit = await checkRouteLimit(request, "alerts");
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", resetAt: limit.resetAt.toISOString() },
        { status: 429 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = waitlistSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid submission", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const email = data.email;

    // Dedupe by email — return existing position if already on list.
    const existing = await db!
      .select({ id: waitlistEntries.id, position: waitlistEntries.position, status: waitlistEntries.status })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        {
          ok: true,
          alreadyOnList: true,
          position: existing[0].position,
          status: existing[0].status,
        },
        { status: 200 },
      );
    }

    const ipHash = hashIp(request);
    const userAgent = request.headers.get("user-agent")?.slice(0, 255) || null;

    const [inserted] = await db!
      .insert(waitlistEntries)
      .values({
        email,
        name: data.name || null,
        organization: data.organization || null,
        role: data.role || null,
        orgType: data.orgType || null,
        chains: data.chains && data.chains.length ? data.chains : null,
        currentStack: data.currentStack || null,
        aumBand: data.aumBand || null,
        useCase: data.useCase || null,
        referralSource: data.referralSource || null,
        ipHash,
        userAgent,
      })
      .returning({ id: waitlistEntries.id, position: waitlistEntries.position });

    // Fire-and-forget confirmation email — never block the response on it.
    void (async () => {
      try {
        await sendWaitlistConfirmationEmail({
          to: email,
          name: data.name || null,
          position: inserted.position,
        });
      } catch (err) {
        console.warn("[waitlist] confirmation email failed:", (err as Error).message);
      }
    })();

    return NextResponse.json(
      { ok: true, position: inserted.position, id: inserted.id },
      { status: 201 },
    );
  } catch (err) {
    console.error("[waitlist] POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Used by the verify route below so we have a stable export name.
export function _generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}
