import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Middleware: Dual auth session check + route protection.
 *
 * Supports TWO authentication systems:
 *   1. SIWS (Sign In With Solana) – signed JWT cookie
 *   2. Neon Auth (Better Auth)    – social sign-in (Google, Discord)
 *
 * - Public: /api/auth/*, /, /marketplace, /pricing, static assets
 * - Protected: /app/*, /api/studio/*, /api/agent/*
 */

const SIWS_COOKIE = 'keystone-siws-session';

const NEON_AUTH_COOKIE_NAMES = [
    '__Secure-neon-auth.session_token',
    'neon-auth.session_token',
    '__Secure-neon-auth.local.session_data',
    'neon-auth.local.session_data',
    'better-auth.session_token',
];

/**
 * Middleware-level Neon Auth check is a SOFT signal only — it cannot verify
 * the session cryptographically without a network call. It is used purely
 * as a UX redirect hint for HTML pages.
 *
 * All protected `/api/*` routes MUST perform their own auth verification
 * (via getAuthUser or equivalent) — never rely on cookie presence alone.
 */
function hasNeonAuthCookieHint(request: NextRequest): boolean {
    return NEON_AUTH_COOKIE_NAMES.some((name) => {
        const cookie = request.cookies.get(name);
        return cookie && cookie.value.length > 0;
    });
}

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET must be configured');
    return new TextEncoder().encode(secret);
}

async function getSiwsPayload(request: NextRequest): Promise<Record<string, unknown> | null> {
    const token = request.cookies.get(SIWS_COOKIE)?.value;
    if (!token) return null;

    try {
        const { payload } = await jwtVerify(token, getJwtSecret(), { issuer: 'keystone-treasury-os' });
        return payload as Record<string, unknown>;
    } catch {
        return null;
    }
}

/** Aligns with robots.txt — HTML/API responses for app-like routes should not be indexed. */
function isPrivateSeoPath(pathname: string): boolean {
    if (pathname === '/hello' || pathname.startsWith('/hello/')) return true;
    if (pathname === '/working-swap' || pathname.startsWith('/working-swap/')) return true;
    return (
        pathname.startsWith('/app') ||
        pathname.startsWith('/auth') ||
        pathname.startsWith('/api') ||
        pathname.startsWith('/github-cleanup') ||
        pathname.startsWith('/mobile')
    );
}

function withSeoHeaders(response: NextResponse, pathname: string): NextResponse {
    if (isPrivateSeoPath(pathname)) {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    // RFC 8288 Link headers — agent discovery hints on every public page.
    // Browsers ignore these; agents (and Cloudflare's agent-ready scanner) read them.
    if (!isPrivateSeoPath(pathname)) {
        response.headers.append(
            'Link',
            '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
        );
        response.headers.append(
            'Link',
            '</.well-known/acp.json>; rel="service-desc"; type="application/json"; title="ACP discovery"',
        );
        response.headers.append(
            'Link',
            '</.well-known/ucp>; rel="service-desc"; type="application/json"; title="UCP profile"',
        );
        response.headers.append(
            'Link',
            '</.well-known/x402>; rel="payment"; type="application/json"; title="x402 capability"',
        );
        response.headers.append(
            'Link',
            '</guides>; rel="service-doc"; type="text/html"; title="dreyv developer guides"',
        );
        response.headers.append(
            'Link',
            '</developers>; rel="service-doc"; type="text/html"; title="dreyv developer portal"',
        );
        response.headers.append(
            'Link',
            '</openapi.json>; rel="describedby"; type="application/json"; title="dreyv OpenAPI 3.1"',
        );
        response.headers.append(
            'Link',
            '</.well-known/ai-plugin.json>; rel="ai-plugin"; type="application/json"; title="OpenAI ai-plugin manifest"',
        );
        response.headers.append(
            'Link',
            '</llms.txt>; rel="llms"; type="text/plain"; title="llms.txt"',
        );
        response.headers.append(
            'Link',
            '</llms-full.txt>; rel="llms-full"; type="text/plain"; title="llms-full.txt"',
        );
        response.headers.append(
            'Link',
            '</sitemap.xml>; rel="sitemap"; type="application/xml"',
        );
        response.headers.append(
            'Link',
            '</waitlist>; rel="related"; type="text/html"; title="dreyv waitlist"',
        );
        response.headers.append(
            'Link',
            '</waitlist.md>; rel="related"; type="text/markdown"; title="dreyv waitlist (machine-readable)"',
        );
    }
    return response;
}

/**
 * Markdown negotiation for agents (Cloudflare "Markdown for Agents" pattern).
 *
 * If a client sends `Accept: text/markdown`, transparently rewrite the request
 * to our markdown-render endpoint so the response body is markdown while HTML
 * remains the default for browsers. Only applies to safe GET requests on
 * indexable HTML pages.
 */
function wantsMarkdown(request: NextRequest): boolean {
    if (request.method !== 'GET') return false;
    const accept = request.headers.get('accept') || '';
    // Browsers send `text/html,...` first; agents that want markdown lead with it.
    return /(^|,\s*)text\/markdown(\s*;|\s*,|$)/i.test(accept);
}

// Canonical host for SEO consolidation. All alternate domains (dreyv.app,
// dreyv.finance, www.* variants) must 308-redirect to this host in a SINGLE
// hop so Google Search Console doesn't flag "Redirect error" / long chains.
const CANONICAL_HOST = 'dreyv.com';
const ALTERNATE_HOSTS = new Set([
    'www.dreyv.com',
    'dreyv.app',
    'www.dreyv.app',
    'dreyv.finance',
    'www.dreyv.finance',
]);

/**
 * Construction gate — temporarily blocks `/app/*` for everyone except
 * allow-listed wallets / emails while we rebuild the dashboard.
 *
 * Enabled when `DREYV_APP_CONSTRUCTION_MODE=true`. Allow-list is a
 * comma-separated list in `DREYV_APP_CONSTRUCTION_ALLOWLIST` of either
 * Solana wallet pubkeys (SIWS `sub`) or emails (Neon Auth `email`).
 *
 * Bypassed for: the rebuilding page itself, static assets, and any
 * non-/app route.
 */
function isConstructionAllowed(payload: Record<string, unknown> | null, allowlist: string[]): boolean {
    if (allowlist.length === 0) return false;
    const sub = typeof payload?.sub === 'string' ? payload.sub : null;
    const email = typeof payload?.email === 'string' ? (payload.email as string).toLowerCase() : null;
    return allowlist.some((entry) => {
        const e = entry.trim().toLowerCase();
        if (!e) return false;
        return e === sub?.toLowerCase() || e === email;
    });
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // ─── App construction gate (must run first) ─────────────────────
    if (
        process.env.DREYV_APP_CONSTRUCTION_MODE === 'true' &&
        pathname.startsWith('/app') &&
        pathname !== '/app-rebuilding' &&
        !pathname.startsWith('/_next') &&
        !pathname.includes('.')
    ) {
        const allowlist = (process.env.DREYV_APP_CONSTRUCTION_ALLOWLIST || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const payload = await getSiwsPayload(request);
        if (!isConstructionAllowed(payload, allowlist)) {
            const origin =
                request.headers.get('x-forwarded-host')
                    ? `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host')}`
                    : request.nextUrl.origin;
            return NextResponse.redirect(new URL('/app-rebuilding', origin), 307);
        }
    }

    // ─── Canonical-host redirect (single hop, 308) ───────────────────
    // Skip in non-production (preview deploys, localhost) so they keep working.
    const hostHeader = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').toLowerCase();
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    if (
        process.env.NODE_ENV === 'production' &&
        hostHeader &&
        ALTERNATE_HOSTS.has(hostHeader) &&
        // Don't redirect Vercel preview / lovable preview hosts
        !hostHeader.endsWith('.vercel.app') &&
        !hostHeader.endsWith('.lovable.app')
    ) {
        const target = new URL(
            pathname + request.nextUrl.search,
            `https://${CANONICAL_HOST}`,
        );
        return NextResponse.redirect(target, 308);
    }

    // ─── Handle Neon Auth OAuth verifier exchange ────────────────────
    // After Google/Discord OAuth, Neon Auth redirects back with
    // ?neon_auth_session_verifier=xxx appended to the callbackURL.
    // Strip it and ensure the user lands on /auth?oauth=complete so the
    // client-side exchange flow can create a local JWT session.
    if (request.nextUrl.searchParams.has('neon_auth_session_verifier')) {
        // Build the redirect URL using the real origin (handles CF Workers
        // where request.nextUrl.clone() can produce http://localhost).
        const origin =
            request.headers.get('x-forwarded-host')
                ? `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host')}`
                : request.nextUrl.origin;
        const cleanUrl = new URL(request.nextUrl.pathname, origin);
        // Copy over existing params except the verifier
        request.nextUrl.searchParams.forEach((value, key) => {
            if (key !== 'neon_auth_session_verifier') {
                cleanUrl.searchParams.set(key, value);
            }
        });
        // Ensure oauth=complete is present (it should be from callbackURL)
        if (!cleanUrl.searchParams.has('oauth')) {
            cleanUrl.searchParams.set('oauth', 'complete');
        }
        console.log('[Middleware] Stripping neon_auth_session_verifier, redirecting to:', cleanUrl.pathname + cleanUrl.search);
        return withSeoHeaders(NextResponse.redirect(cleanUrl), pathname);
    }

    // ─── Markdown negotiation for agents ────────────────────────────
    // Public HTML page + `Accept: text/markdown` → proxy to render-markdown.
    // Browsers (Accept: text/html,...) are unaffected.
    if (
        wantsMarkdown(request) &&
        !pathname.startsWith('/api/') &&
        !pathname.startsWith('/_next/') &&
        !pathname.includes('.') &&
        !isPrivateSeoPath(pathname)
    ) {
        const origin =
            request.headers.get('x-forwarded-host')
                ? `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host')}`
                : request.nextUrl.origin;
        const target = `${origin}${pathname}${request.nextUrl.search}`;
        try {
            const upstream = await fetch(`${origin}/api/studio/render-markdown`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: target }),
                // Keep latency in check; agents can fall back to HTML on failure.
                signal: AbortSignal.timeout(10_000),
            });
            if (upstream.ok) {
                const data = (await upstream.json()) as { markdown?: string };
                const md = data.markdown ?? '';
                const headers = new Headers({
                    'Content-Type': 'text/markdown; charset=utf-8',
                    'Cache-Control': 'public, max-age=300, s-maxage=300',
                    'Vary': 'Accept',
                    'X-Markdown-Source': target,
                });
                const tokenEstimate = Math.ceil(md.length / 4);
                headers.set('x-markdown-tokens', String(tokenEstimate));
                const res = new NextResponse(md, { status: 200, headers });
                return withSeoHeaders(res, pathname);
            }
        } catch (err) {
            // Fall through to normal HTML response on failure.
            console.warn('[middleware] markdown negotiation failed:', (err as Error).message);
        }
    }

    // ─── Skip public routes ─────────────────────────────────────────
    const publicPaths = [
        '/api/auth',
        '/api/health',
        '/_next',
        '/favicon',
        '/images',
        '/fonts',
        '/manifest',
    ];

    const publicPages = ['/', '/marketplace', '/pricing', '/atlas', '/docs', '/about', '/auth', '/app-rebuilding', '/studio'];

    if (
        publicPaths.some((p) => pathname.startsWith(p)) ||
        publicPages.includes(pathname) ||
        pathname.startsWith('/legal') ||
        pathname.startsWith('/guides') ||
        pathname.startsWith('/accept-team-invite') ||
        pathname.startsWith('/accept-vault-invite') ||
        pathname.includes('.')
    ) {
        return withSeoHeaders(NextResponse.next(), pathname);
    }

    // ─── Check both auth systems in parallel ────────────────────────
    // SIWS is cryptographically verified here; Neon cookie is only a UX hint.
    const [siwsPayload, hasNeonHint] = await Promise.all([
        getSiwsPayload(request),
        Promise.resolve(hasNeonAuthCookieHint(request)),
    ]);

    const hasSiws = !!siwsPayload;
    // For HTML page redirects, treat the Neon cookie hint as "maybe signed in"
    // to avoid a redirect loop while the client finalises OAuth exchange.
    const isAuthenticatedForPages = hasSiws || hasNeonHint;
    // For API routes we ONLY trust verified SIWS at the middleware layer;
    // route handlers MUST do their own Neon Auth verification.
    const isAuthenticatedForApi = hasSiws;

    // ─── Public API routes (no auth required) ───────────────────────
    // Artifact download routes self-authenticate via signed JWT in `?t=`
    // (see /api/agent/artifacts/[id]) — they must be reachable without
    // a session cookie so download links work in any browser tab.
    const publicApiPaths = ['/api/studio/marketplace', '/api/studio/unlock', '/api/studio/media'];
    const isPublicArtifactRoute =
        pathname.startsWith('/api/agent/artifacts/') && request.method === 'GET';
    const isStudioGatedRoute =
        pathname.startsWith('/api/studio/unlock') || pathname.startsWith('/api/studio/media');
    if (
        isPublicArtifactRoute ||
        isStudioGatedRoute ||
        publicApiPaths.some((p) => pathname === p || (pathname.startsWith(p) && request.method === 'GET'))
    ) {
        return withSeoHeaders(
            NextResponse.next({ request: { headers: request.headers } }),
            pathname,
        );
    }

    // ─── CLI publish endpoints (self-authenticated, no cookies needed) ──
    // /api/studio/publish/auth   — GET, returns challenge nonce (public)
    // /api/studio/publish/register — POST, registers developer (rate-limited, self-protected)
    // /api/studio/publish        — POST with bearer/signature headers (route does own auth)
    if (pathname === '/api/studio/publish/auth' || pathname === '/api/studio/publish/register') {
        return withSeoHeaders(
            NextResponse.next({ request: { headers: request.headers } }),
            pathname,
        );
    }

    // ─── CLI auth bypass: let bearer-token / wallet-signature requests through ──
    // The publish route handler does its own verification of these credentials.
    if (
        (pathname === '/api/studio/publish' || pathname.startsWith('/api/studio/publish/')) &&
        (request.headers.has('authorization') || request.headers.has('x-keystone-signature'))
    ) {
        return withSeoHeaders(
            NextResponse.next({ request: { headers: request.headers } }),
            pathname,
        );
    }

    // ─── Protect /app/* and /api/* routes ───────────────────────────
    const protectedPaths = ['/app', '/api/studio', '/api/agent', '/api/dca'];

    const isApiRoute = pathname.startsWith('/api/');
    const isAuthed = isApiRoute ? isAuthenticatedForApi : isAuthenticatedForPages;

    if (protectedPaths.some((p) => pathname.startsWith(p)) && !isAuthed) {
        if (isApiRoute) {
            return withSeoHeaders(
                NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 }),
                pathname,
            );
        }

        // Use the real origin (CF Workers can make nextUrl.clone() return localhost)
        const origin =
            request.headers.get('x-forwarded-host')
                ? `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host')}`
                : request.nextUrl.origin;
        const url = new URL('/auth', origin);
        // Preserve the intended destination so auth page can redirect back
        if (pathname !== '/app') {
            url.searchParams.set('redirect', pathname);
        }
        return withSeoHeaders(NextResponse.redirect(url), pathname);
    }

    // ─── Admin Role Gate ────────────────────────────────────────────
    if (pathname.startsWith('/app/admin')) {
        if (!isAuthenticatedForPages) {
            const url = request.nextUrl.clone();
            url.pathname = '/auth';
            return withSeoHeaders(NextResponse.redirect(url), pathname);
        }
    }

    // ─── Onboarding redirect for authenticated but un-onboarded users ──
    if (
        isAuthenticatedForPages &&
        pathname.startsWith('/app') &&
        !pathname.startsWith('/app/onboarding') &&
        !pathname.startsWith('/api/') &&
        siwsPayload &&
        siwsPayload.onboarded === false
    ) {
        const url = request.nextUrl.clone();
        url.pathname = '/app/onboarding';
        return withSeoHeaders(NextResponse.redirect(url), pathname);
    }

    return withSeoHeaders(
        NextResponse.next({ request: { headers: request.headers } }),
        pathname,
    );
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
