export const runtime = "edge";
/**
 * GET /api/auth/callback
 *
 * Legacy Supabase OAuth callback. The active OAuth flow is handled by
 * Better Auth at /api/auth/callback/:provider. If Google Cloud Console
 * still points at this URL, forward the request (with code + state) to
 * Better Auth's Google callback so the PKCE verifier lookup succeeds.
 *
 * The previous implementation called supabase.auth.exchangeCodeForSession,
 * which fails with "verifier not found" because the verifier was stored
 * by Better Auth, not Supabase.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const incoming = new URL(request.url);
    const target = new URL('/api/auth/callback/google', incoming.origin);
    incoming.searchParams.forEach((v, k) => target.searchParams.set(k, v));
    return NextResponse.redirect(target, { status: 307 });
}
