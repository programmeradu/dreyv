import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

export const runtime = "edge";

const COOKIE = "dreyv-benchmark-allow";
const MAX_AGE = 60 * 60 * 8; // 8 hours
const PASSWORD = "opensesame";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be configured");
  return new TextEncoder().encode(secret);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  if (password !== PASSWORD) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const token = await new SignJWT({ purpose: "benchmark-access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .setIssuer("keystone-treasury-os")
    .sign(getJwtSecret());

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}
