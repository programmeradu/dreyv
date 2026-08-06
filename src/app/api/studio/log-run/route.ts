import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { studioRuns } from "@/db/schema";
import { randomBytes } from "crypto";
import { jwtVerify } from "jose";
export const runtime = "edge";

function shortId(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = randomBytes(12);
  let r = "";
  for (let i = 0; i < 12; i++) r += chars[bytes[i] % chars.length];
  return r;
}

async function getUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get("keystone-siws-session")?.value;
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: "keystone-treasury-os",
    });
    return payload.sub as string;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!db) return NextResponse.json({ ok: false, error: "DB unavailable" }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const userId = await getUserId(req);

  try {
    await db.insert(studioRuns).values({
      shortId: shortId(),
      userId: userId || null,
      prompt: String(body.prompt || "").slice(0, 4000),
      promptCategory: (body.promptCategory as string) || null,
      clarifyAnswers: body.clarifyAnswers || null,
      chosenIntegrations: body.chosenIntegrations || null,
      unknownProtocols: body.unknownProtocols || null,
      researchSources: body.researchSources || null,
      analyzerOutcome: (body.analyzerOutcome as string) || null,
      attempts: typeof body.attempts === "number" ? body.attempts : null,
      shipped: !!body.shipped,
      errors: body.errors || null,
      durationMs: typeof body.durationMs === "number" ? body.durationMs : null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[studio/log-run] insert failed:", err);
    return NextResponse.json({ ok: false, error: "Insert failed" }, { status: 500 });
  }
}
