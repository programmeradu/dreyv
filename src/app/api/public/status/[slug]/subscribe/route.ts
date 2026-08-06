/**
 * POST /api/public/status/[slug]/subscribe
 * Anon-callable email subscribe endpoint for a published status page.
 * Generates a confirmation token; user must click /status/[slug]/confirm to activate.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { publicApiStatusPages, publicApiStatusSubscribers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
export const runtime = "edge";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const [page] = await db
    .select({ id: publicApiStatusPages.id, slug: publicApiStatusPages.slug })
    .from(publicApiStatusPages)
    .where(and(eq(publicApiStatusPages.slug, slug), eq(publicApiStatusPages.isPublic, true)))
    .limit(1);
  if (!page) return NextResponse.json({ error: "page_not_found" }, { status: 404 });

  // Upsert by (pageId, channel, target). If already exists & confirmed, return ok.
  const existing = await db
    .select()
    .from(publicApiStatusSubscribers)
    .where(
      and(
        eq(publicApiStatusSubscribers.pageId, page.id),
        eq(publicApiStatusSubscribers.channel, "email"),
        eq(publicApiStatusSubscribers.target, email),
      ),
    )
    .limit(1);

  const token = randomBytes(24).toString("base64url");

  if (existing[0]) {
    if (existing[0].confirmedAt && !existing[0].unsubscribedAt) {
      return NextResponse.json({ ok: true, already: true });
    }
    await db
      .update(publicApiStatusSubscribers)
      .set({ confirmToken: token, unsubscribedAt: null })
      .where(eq(publicApiStatusSubscribers.id, existing[0].id));
    return NextResponse.json({ ok: true, id: existing[0].id });
  }

  const [row] = await db
    .insert(publicApiStatusSubscribers)
    .values({
      pageId: page.id,
      channel: "email",
      target: email,
      confirmToken: token,
    })
    .returning({ id: publicApiStatusSubscribers.id });

  return NextResponse.json({ ok: true, id: row.id });
}
