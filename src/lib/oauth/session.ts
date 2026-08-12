/**
 * Resolve the current dreyv user from request cookies for OAuth flows.
 * Reuses the SIWS JWT path used by `getAuthUser`.
 */

import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

const SIWS_COOKIE = "keystone-siws-session";

function jwtSecret(): Uint8Array {
  const s = process.env.JWT_SECRET || "dreyv-siws-secret-fallback-2026";
  return new TextEncoder().encode(s);
}

export interface OAuthUser {
  id: string;
  walletAddress: string;
  email: string | null;
  displayName: string | null;
}

export async function getOAuthUser(): Promise<OAuthUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(SIWS_COOKIE)?.value;
    const database = getDb();
    if (!token || !database) return null;
    const { payload } = await jwtVerify(token, jwtSecret(), {
      issuer: "keystone-treasury-os",
    });
    const wallet = typeof payload.wallet === "string" ? payload.wallet : null;
    if (!wallet) return null;
    const [u] = await database
      .select({
        id: users.id,
        walletAddress: users.walletAddress,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.walletAddress, wallet))
      .limit(1);
    return u ?? null;
  } catch {
    return null;
  }
}
