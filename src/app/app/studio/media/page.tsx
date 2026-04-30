/**
 * /app/studio/media — Dreyv Media Studio (private, team-only).
 *
 * Server-renders a noindex shell and gates access via the same SIWS session
 * cookie used elsewhere. Anonymous visitors see a soft prompt to sign in;
 * non-team members see a 403-style explanation instead of the workbench.
 */

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import MediaStudioClient from "./MediaStudioClient";

export const metadata: Metadata = {
  title: "Media Studio · Dreyv",
  description: "Internal Dreyv brand & content workbench.",
  robots: { index: false, follow: false },
};

const SIWS_COOKIE = "keystone-siws-session";

async function resolveTeamMember(): Promise<{ allowed: boolean; reason?: string }> {
  const token = (await cookies()).get(SIWS_COOKIE)?.value;
  if (!token) return { allowed: false, reason: "signin" };

  const secret = process.env.JWT_SECRET;
  if (!secret) return { allowed: false, reason: "config" };

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: "keystone-treasury-os",
    });
    const wallet = payload.wallet as string | undefined;
    if (!wallet || !db) return { allowed: false, reason: "signin" };
    const [user] = await db
      .select({ role: users.role, wallet: users.walletAddress })
      .from(users)
      .where(eq(users.walletAddress, wallet))
      .limit(1);
    if (!user) return { allowed: false, reason: "signin" };

    const teamWallets = new Set(
      (process.env.DREYV_TEAM_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    );
    if (user.role === "admin" || user.role === "creator" || teamWallets.has(user.wallet)) {
      return { allowed: true };
    }
    return { allowed: false, reason: "team" };
  } catch {
    return { allowed: false, reason: "signin" };
  }
}

export default async function MediaStudioPage() {
  const gate = await resolveTeamMember();
  if (!gate.allowed) {
    return <Gate reason={gate.reason ?? "signin"} />;
  }
  return <MediaStudioClient />;
}

function Gate({ reason }: { reason: string }) {
  const isTeam = reason === "team";
  return (
    <div
      className="flex min-h-[80vh] items-center justify-center bg-white px-6 text-[#0B0820]"
      style={{ fontFamily: "Manrope, ui-sans-serif, system-ui" }}
    >
      <div className="max-w-md rounded-3xl border border-violet-200 bg-white p-8 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-700">
          Dreyv · Media Studio
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">
          {isTeam ? "Team only" : "Sign in to continue"}
        </h1>
        <p className="mt-2 text-sm text-[#0B0820]/65">
          {isTeam
            ? "The Media Studio is restricted to Dreyv team members. If you should have access, ask the founder to add your wallet to the team allowlist."
            : "The Media Studio is private. Sign in with your Dreyv team wallet to continue."}
        </p>
        {!isTeam && (
          <Link
            href="/auth"
            className="mt-5 inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700"
          >
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}
