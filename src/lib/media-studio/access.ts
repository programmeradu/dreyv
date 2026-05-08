/**
 * Server-side gate for /app/studio/media + its API routes.
 *
 * v1 policy (per founder): any authenticated Dreyv team member can use it.
 * "Team member" = the user has logged in via SIWS *and* their wallet/email
 * matches an allowlist OR their `users.role` is `admin` or `creator`.
 *
 * Until the team allowlist is wired into a dedicated table, we accept any
 * authenticated user with role in {admin, creator} OR the env-configured
 * DREYV_TEAM_WALLETS list (comma-separated). This keeps the studio private
 * by default while not blocking the founding team.
 */

import { NextRequest } from "next/server";
import { getAuthUser, type AuthUser } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export type TeamMember = AuthUser & { role: string };

function teamWallets(): Set<string> {
  const raw = process.env.DREYV_TEAM_WALLETS ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export const STUDIO_PASS_COOKIE = "dreyv-studio-pass";
export const STUDIO_PASS_VALUE = "opensesame";
export const STUDIO_PASS_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function requireTeamMember(req: NextRequest): Promise<
  | { ok: true; user: TeamMember }
  | { ok: false; status: number; error: string }
> {
  // Simple shared-password gate. Cookie is primary; header is a preview-safe
  // fallback because some embedded preview flows can drop Set-Cookie.
  const pass = req.cookies.get(STUDIO_PASS_COOKIE)?.value;
  const headerPass = req.headers.get("x-dreyv-studio-pass");
  if (pass === STUDIO_PASS_VALUE || headerPass === STUDIO_PASS_VALUE) {
    return {
      ok: true,
      user: {
        id: STUDIO_PASS_USER_ID,
        walletAddress: "studio-pass",
        tier: "max",
        evmWalletAddress: null,
        role: "creator",
      },
    };
  }

  const auth = await getAuthUser(req);
  if (!auth) return { ok: false, status: 401, error: "Sign in required" };
  if (!db) return { ok: false, status: 500, error: "Database unavailable" };

  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, auth.id))
    .limit(1);
  const role = row?.role ?? "user";

  const allowed =
    role === "admin" ||
    role === "creator" ||
    teamWallets().has(auth.walletAddress);

  if (!allowed) {
    return { ok: false, status: 403, error: "Media Studio is restricted to Dreyv team members" };
  }
  return { ok: true, user: { ...auth, role } };
}
