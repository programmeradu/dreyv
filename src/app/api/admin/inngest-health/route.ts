/**
 * Admin: Inngest health check.
 *
 * Reports:
 *  - Whether the gateway envs are present (LOVABLE_API_KEY + INNGEST_API_KEY)
 *  - Whether the local /api/inngest serve endpoint responds (functions registered)
 *  - Whether the Inngest Management API recognises this app + last function-run timestamp
 *
 * NOTE: this only tells you the truth about whatever URL Inngest has registered
 * for the app id `dreyv-agents`. A green check here on prod does NOT mean the
 * preview URL is also synced.
 */
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/db";
import { jwtVerify } from "jose";

export const dynamic = "force-dynamic";

function getAdminToken(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) return authHeader.substring(7);
  const siwsCookie = req.cookies.get("keystone-siws-session")?.value;
  if (siwsCookie) return siwsCookie;
  const neonCookie =
    req.cookies.get("better-auth.session_token")?.value ||
    req.cookies.get("__Secure-neon-auth.session_token")?.value ||
    req.cookies.get("neon-auth.session_token")?.value;
  return neonCookie ?? null;
}

async function requireAdmin(req: NextRequest) {
  if (!db) return { ok: false as const, status: 500, error: "Database not configured" };
  const token = getAdminToken(req);
  if (!token) return { ok: false as const, status: 401, error: "Unauthorized" };
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return { ok: false as const, status: 503, error: "Auth not configured" };
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    const wallet = (payload as any).wallet || payload.sub;
    const liveUser = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.walletAddress, wallet as string),
    });
    if (!liveUser || liveUser.role !== "admin") {
      return { ok: false as const, status: 403, error: "Forbidden" };
    }
  } catch {
    return { ok: false as const, status: 401, error: "Invalid token" };
  }
  return { ok: true as const };
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const lovableKey = process.env.LOVABLE_API_KEY;
  const gatewayKey = process.env.INNGEST_API_KEY;
  const signingKey = process.env.INNGEST_SIGNING_KEY;

  const env = {
    lovableApiKey: Boolean(lovableKey),
    inngestApiKey: Boolean(gatewayKey),
    inngestSigningKey: Boolean(signingKey),
  };

  // 1. Serve endpoint introspection — use the public app URL so the probe
  //    reflects what Inngest actually sees in cloud, not the internal
  //    localhost the Next server happens to bind to.
  const hdrs = await headers();
  const headerHost = hdrs.get("host") ?? "";
  const proto = hdrs.get("x-forwarded-proto") || "https";
  const headerUrl =
    headerHost && !headerHost.includes("localhost")
      ? `${proto}://${headerHost}/api/inngest`
      : null;
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const serveUrl = publicUrl ? `${publicUrl}/api/inngest` : headerUrl;

  let serve: {
    url: string | null;
    reachable: boolean;
    appId?: string;
    functionCount?: number;
    mode?: string;
    error?: string;
  } = { url: serveUrl, reachable: false };

  if (serveUrl) {
    try {
      const r = await fetch(serveUrl, { method: "GET", cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      serve = {
        url: serveUrl,
        reachable: r.ok,
        appId: body?.appId ?? body?.appName,
        functionCount: Array.isArray(body?.functions)
          ? body.functions.length
          : (body?.function_count ?? body?.functionsFound),
        mode: body?.mode,
      };
    } catch (e: any) {
      serve = { url: serveUrl, reachable: false, error: String(e?.message ?? e) };
    }
  } else {
    serve = { url: null, reachable: false, error: "Set NEXT_PUBLIC_APP_URL to probe the prod serve endpoint" };
  }

  // 2. Gateway credential verification
  let gateway: { verified: boolean; outcome?: string; latencyMs?: number; error?: string } = {
    verified: false,
  };
  if (lovableKey && gatewayKey) {
    try {
      const r = await fetch("https://connector-gateway.lovable.dev/api/v1/verify_credentials", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": gatewayKey,
        },
      });
      const body = await r.json().catch(() => ({}));
      gateway = {
        verified: r.ok && body?.outcome === "verified",
        outcome: body?.outcome,
        latencyMs: body?.latency_ms,
        error: body?.error ?? (r.ok ? undefined : `HTTP ${r.status}`),
      };
    } catch (e: any) {
      gateway = { verified: false, error: String(e?.message ?? e) };
    }
  } else {
    gateway = { verified: false, error: "Missing gateway credentials" };
  }

  // 3. Inngest Management API — recent function runs
  //    (uses INNGEST_SIGNING_KEY as Bearer per Lovable connector docs)
  let runs: {
    queried: boolean;
    count?: number;
    lastRunAt?: string | null;
    statuses?: Record<string, number>;
    error?: string;
  } = { queried: false };
  if (signingKey) {
    try {
      const r = await fetch("https://api.inngest.com/v1/events?limit=20", {
        headers: { Authorization: `Bearer ${signingKey}` },
        cache: "no-store",
      });
      if (!r.ok) {
        runs = { queried: true, error: `Management API HTTP ${r.status}` };
      } else {
        const body = await r.json().catch(() => ({}));
        const data: any[] = Array.isArray(body?.data) ? body.data : [];
        const lastRunAt =
          data.length > 0
            ? data
                .map((d) => d?.received_at ?? d?.occurred_at ?? d?.ts)
                .filter(Boolean)
                .sort()
                .pop() ?? null
            : null;
        runs = { queried: true, count: data.length, lastRunAt };
      }
    } catch (e: any) {
      runs = { queried: true, error: String(e?.message ?? e) };
    }
  } else {
    runs = { queried: false, error: "Missing INNGEST_SIGNING_KEY" };
  }

  const synced = serve.reachable && gateway.verified;
  const status: "healthy" | "warning" | "down" =
    synced && (runs.count ?? 0) > 0
      ? "healthy"
      : synced
        ? "warning"
        : "down";

  return NextResponse.json({
    status,
    env,
    serve,
    gateway,
    runs,
    note:
      "Inngest only invokes functions for the URL it has registered for the app id `dreyv-agents`. " +
      "If you are viewing a Lovable preview URL, function runs will execute against your production " +
      "deploy, not this preview — this panel reflects the production sync state.",
    checkedAt: new Date().toISOString(),
  });
}
