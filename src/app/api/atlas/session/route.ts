export const runtime = "edge";
/**
 * Atlas Session API — Wallet-Based Session Recovery
 *
 * AUTH: All methods require a valid SIWS/Neon-Auth session, AND the
 * authenticated session wallet MUST match the requested `wallet`.
 *
 * GET     ?wallet=<address>           — Recover session
 * POST    { wallet, messages, ctx }   — Save messages/context
 * DELETE  ?wallet=<address>           — Clear session
 */

import { NextRequest, NextResponse } from "next/server";
import {
    getOrCreateSession,
    saveConversation,
    clearSession,
    updateSessionContext,
    type AtlasMessage,
} from "@/lib/atlas-session";
import { getAuthUser } from "@/lib/auth-utils";


export const dynamic = "force-dynamic";

async function authorize(req: NextRequest, requestedWallet: string | null) {
    if (!requestedWallet) {
        return { error: NextResponse.json({ error: "wallet is required" }, { status: 400 }) };
    }
    const user = await getAuthUser(req);
    if (!user) {
        return { error: NextResponse.json({ error: "Unauthorized. Please sign in." }, { status: 401 }) };
    }
    if (user.walletAddress.toLowerCase() !== requestedWallet.toLowerCase()) {
        return { error: NextResponse.json({ error: "Forbidden: wallet mismatch" }, { status: 403 }) };
    }
    return { user };
}

// GET — Recover session for a wallet
export async function GET(req: NextRequest) {
    try {
        const wallet = req.nextUrl.searchParams.get("wallet");
        const auth = await authorize(req, wallet);
        if ("error" in auth) return auth.error;

        const session = await getOrCreateSession(wallet!);

        if (!session) {
            return NextResponse.json({
                wallet,
                hasSession: false,
                conversationHistory: [],
                context: null,
            });
        }

        return NextResponse.json({
            wallet,
            hasSession: true,
            sessionId: session.id,
            conversationHistory: session.conversationHistory,
            lastQuery: session.lastQuery,
            context: session.context,
            expiresAt: session.expiresAt.toISOString(),
            createdAt: session.createdAt.toISOString(),
        });
    } catch (error: any) {
        console.error("[atlas-session API] GET error:", error);
        return NextResponse.json(
            { error: "Failed to recover session" },
            { status: 500 }
        );
    }
}

// POST — Save messages and/or context
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { wallet, messages, context } = body as {
            wallet: string;
            messages?: AtlasMessage[];
            context?: Record<string, unknown>;
        };

        const auth = await authorize(req, wallet);
        if ("error" in auth) return auth.error;

        let saved = false;

        if (messages && messages.length > 0) {
            saved = await saveConversation(wallet, messages);
        }

        if (context) {
            saved = await updateSessionContext(wallet, context) || saved;
        }

        return NextResponse.json({
            ok: saved,
            wallet,
        });
    } catch (error: any) {
        console.error("[atlas-session API] POST error:", error);
        return NextResponse.json(
            { error: "Failed to save session" },
            { status: 500 }
        );
    }
}

// DELETE — Clear session history
export async function DELETE(req: NextRequest) {
    try {
        const wallet = req.nextUrl.searchParams.get("wallet");
        const auth = await authorize(req, wallet);
        if ("error" in auth) return auth.error;

        const cleared = await clearSession(wallet!);

        return NextResponse.json({
            ok: cleared,
            wallet,
        });
    } catch (error: any) {
        console.error("[atlas-session API] DELETE error:", error);
        return NextResponse.json(
            { error: "Failed to clear session" },
            { status: 500 }
        );
    }
}
