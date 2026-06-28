'use client';

/**
 * Neon Auth client helper.
 *
 * The @neondatabase/auth beta package ships without its dist/ files,
 * so importing from '@neondatabase/auth/next' breaks the build.
 *
 * This shim preserves the Neon-like authClient API and delegates
 * auth actions to the proxied Neon Auth endpoints under /api/auth.
 */

interface AuthSessionData {
    session: unknown;
    user: { id: string; email?: string; name?: string };
}

interface AuthSession {
    data: AuthSessionData | null;
    error: { message: string } | null;
}

function appOrigin() {
    if (typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin;
    }
    return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || '';
}

function absoluteAppUrl(pathOrUrl: string, fallbackPath: string) {
    const origin = appOrigin();
    const raw = pathOrUrl || fallbackPath;

    try {
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
            const url = new URL(raw);
            const currentOrigin = origin ? new URL(origin).origin : url.origin;
            // OAuth callbacks must return to the current app origin. If a
            // caller passes our own absolute URL, normalize it against the
            // runtime origin so previews and production both work correctly.
            return `${currentOrigin}${url.pathname}${url.search}${url.hash}`;
        }
    } catch {
        // Fall through to the safe fallback below.
    }

    if (!origin) return fallbackPath;
    return new URL(raw.startsWith('/') ? raw : fallbackPath, origin).toString();
}

export const authClient = {
    async getSession(): Promise<AuthSession> {
        try {
            const res = await fetch('/api/auth/get-session', {
                method: 'GET',
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });

            if (!res.ok) {
                return { data: null, error: null };
            }

            const payload = await res.json().catch(() => null) as any;
            const session = payload?.session || payload?.data?.session || null;
            const user = payload?.user || payload?.data?.user || session?.user || null;

            if (!session || !user?.id) {
                return { data: null, error: null };
            }

            return {
                data: {
                    session,
                    user: {
                        id: user.id,
                        email: user.email,
                        name: user.name || user.fullName || user.email,
                    },
                },
                error: null,
            };
        } catch {
            return { data: null, error: null };
        }
    },
    signIn: {
        async social(opts: { provider: string; callbackURL?: string }) {
            // Neon Auth runs on its own host. Relative callbackURL values are
            // resolved against that host and strand users on
            // neonauth.../auth?oauth=complete (404). Always send a full app
            // URL; the origin must be present in Neon Auth trusted domains.
            const callback = absoluteAppUrl(opts.callbackURL || '/app', '/app');
            const errorCallback = absoluteAppUrl('/auth?oauth=error', '/auth?oauth=error');


            const res = await fetch('/api/auth/sign-in/social', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: opts.provider,
                    callbackURL: callback,
                    errorCallbackURL: errorCallback,
                }),
                redirect: 'follow',
            });

            if (res.redirected) {
                window.location.href = res.url;
                return;
            }

            const location = res.headers.get('location');
            if (location) {
                window.location.href = location;
                return;
            }

            const data = await res.json().catch(() => null);
            const redirectUrl = data?.url || data?.redirect;
            if (redirectUrl) {
                window.location.href = redirectUrl;
                return;
            }

            const rawMessage = data?.message || data?.error?.message || data?.error;
            const message = data?.code === 'INVALID_CALLBACKURL' || rawMessage === 'Invalid callbackURL'
                ? `Google sign-in is missing this app origin in Neon Auth trusted domains: ${appOrigin() || 'current app origin'}. Add it, then retry.`
                : rawMessage
                || `Sign-in with ${opts.provider} is not configured. Enable the ${opts.provider} provider in the auth backend.`;
            throw new Error(typeof message === 'string' ? message : `Failed to start ${opts.provider} sign-in`);
        },
    },
    async signOut() {
        try {
            const postRes = await fetch('/api/auth/sign-out', {
                method: 'POST',
                credentials: 'include',
            });

            if (!postRes.ok) {
                await fetch('/api/auth/sign-out', {
                    method: 'GET',
                    credentials: 'include',
                });
            }
        } catch {
            // Swallow sign-out errors so logout UX can continue.
        }
    },
};
