/**
 * POST /api/studio/publish/register — Register a developer wallet for CLI publish.
 *
 * BYO-key only: provide { walletAddress } to register an existing wallet
 * and get a developer token back for CLI use.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { developerTokens } from "@/db/schema";
import { checkRouteLimit } from "@/lib/rate-limit-middleware";
import { eq, and } from "drizzle-orm";
export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const rateLimit = await checkRouteLimit(request, "developer_registrations");
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", resetAt: rateLimit.resetAt.toISOString() },
        { status: 429 }
      );
    }

    const body = (await request.json()) as {
      label?: string;
      walletAddress?: string;
    };

    const label = body.label || "default";

    if (!db) {
      return NextResponse.json({ error: "Database not available" }, { status: 503 });
    }

    if (!body.walletAddress) {
      return NextResponse.json(
        {
          error:
            "walletAddress is required. Run `dreyv register --wallet <pubkey>` to register a BYO key.",
        },
        { status: 400 }
      );
    }

    // Check if token already exists for this wallet
    const existing = await db
      .select()
      .from(developerTokens)
      .where(
        and(
          eq(developerTokens.walletAddress, body.walletAddress),
          eq(developerTokens.revoked, false)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({
        walletAddress: existing[0].walletAddress,
        developerToken: existing[0].token,
        mode: "existing",
      });
    }

    const token = crypto.randomUUID();
    await db.insert(developerTokens).values({
      token,
      walletAddress: body.walletAddress,
      label,
    });

    return NextResponse.json({
      walletAddress: body.walletAddress,
      developerToken: token,
      mode: "byo-key",
    });
  } catch (err) {
    console.error("[register] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Registration failed" },
      { status: 500 }
    );
  }
}
