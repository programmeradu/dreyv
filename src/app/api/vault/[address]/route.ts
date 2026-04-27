/**
 * /api/vault/[address] — Per-vault management.
 *
 * PATCH  → rename ({ label })
 * DELETE → remove a vault from the user's registry
 *
 * Both operations are scoped to the authenticated user; cross-user access
 * is rejected with 404 to avoid leaking address ownership.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { vaults } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAuthUser } from "@/lib/auth-utils";
import { errors } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwnedVault(userId: string, address: string) {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(vaults)
    .where(and(eq(vaults.userId, userId), eq(vaults.address, address)))
    .limit(1);
  return row ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return errors.unauthorized();
    if (!db) return errors.serviceUnavailable("Database");

    const { address } = await params;
    const body = await request.json().catch(() => ({}));
    const label = typeof body?.label === "string" ? body.label.trim().slice(0, 60) : null;

    if (!label) return errors.badRequest("label required");

    const owned = await loadOwnedVault(authUser.id, address);
    if (!owned) return errors.notFound("Vault");

    const [updated] = await db
      .update(vaults)
      .set({ label })
      .where(eq(vaults.id, owned.id))
      .returning();

    return NextResponse.json({ vault: updated });
  } catch (err) {
    console.error("[vault/PATCH] Error:", err);
    return errors.internal("Failed to update vault");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return errors.unauthorized();
    if (!db) return errors.serviceUnavailable("Database");

    const { address } = await params;
    const owned = await loadOwnedVault(authUser.id, address);
    if (!owned) return errors.notFound("Vault");

    await db.delete(vaults).where(eq(vaults.id, owned.id));
    return NextResponse.json({ ok: true, address });
  } catch (err) {
    console.error("[vault/DELETE] Error:", err);
    return errors.internal("Failed to delete vault");
  }
}
