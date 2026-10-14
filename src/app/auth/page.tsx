"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useWallet, useWalletModal } from "@/lib/wallet/compat";
import { useConnect } from "@phantom/react-sdk";
import { useKeystoneAuth } from "@/hooks/useKeystoneAuth";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { getPhantomPortalOrigin, getPhantomRedirectUrl } from "@/lib/wallet/phantom-auth-config";
import {
    Wallet,
    PenLine,
    Loader2,
    AlertCircle,
    ArrowRight,
    RefreshCw,
    Lock,
    Check,
} from "lucide-react";

import { DreyvMark } from "@/components/brand/dreyv-mark";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { EvmConnectButton } from "@/components/EvmConnectButton";
import { newsreader, inter, urbanist } from "@/components/marketing/fonts";
import "./auth-ink.css";

const LOGO_DEV_TOKEN = "pk_DFEjHHL4QteaMOzcFuSlwg";

const logoSrc = (domain: string) =>
    `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&format=png&size=120&fallback=monogram&theme=light`;

/* eslint-disable @next/next/no-img-element */

// Page frame: paper ground, wordmark, ink drawings (desktop door scene, phone robot and bench strip).
// The art is decorative, absolutely positioned and sized by width/height attributes, so it never shifts layout.
function InkFrame({ children }: { children: React.ReactNode }) {
    return (
        <div className={`ak ${newsreader.variable} ${inter.variable} ${urbanist.variable}`}>
            <header className="ak-head">
                <a href="/" aria-label="dreyv home" className="ak-wm">
                    dreyv
                </a>
            </header>

            <picture className="ak-art ak-art-d" aria-hidden="true">
                <source
                    type="image/avif"
                    srcSet="/art/auth-ink-door-1440.avif 1440w, /art/auth-ink-door-2400.avif 2400w"
                    sizes="100vw"
                />
                <source
                    type="image/webp"
                    srcSet="/art/auth-ink-door-1440.webp 1440w, /art/auth-ink-door-2400.webp 2400w"
                    sizes="100vw"
                />
                <img src="/art/auth-ink-door-1440.webp" alt="" width={2400} height={1340} decoding="async" />
            </picture>

            <picture className="ak-art ak-art-m ak-m-sit" aria-hidden="true">
                <source type="image/avif" srcSet="/art/auth-ink-robot-sit.avif" />
                <img src="/art/auth-ink-robot-sit.webp" alt="" width={310} height={270} decoding="async" />
            </picture>

            <picture className="ak-art ak-art-m ak-m-bench" aria-hidden="true">
                <source
                    type="image/avif"
                    srcSet="/art/auth-ink-bench-800.avif 800w, /art/auth-ink-bench-1200.avif 1200w"
                    sizes="100vw"
                />
                <source
                    type="image/webp"
                    srcSet="/art/auth-ink-bench-800.webp 800w, /art/auth-ink-bench-1200.webp 1200w"
                    sizes="100vw"
                />
                <img src="/art/auth-ink-bench-800.webp" alt="" width={1200} height={485} decoding="async" />
            </picture>

            <main className="ak-main">
                <div className="ak-form">{children}</div>
            </main>
        </div>
    );
}

// ─── Buttons ────────────────────────────────────────────────────────
function WalletRow({
    name,
    domain,
    onClick,
    recommended,
}: {
    name: string;
    domain: string;
    onClick: () => void;
    recommended?: boolean;
}) {
    return (
        <button type="button" onClick={onClick} className={`ak-row${recommended ? " is-rec" : ""}`}>
            <span className="ak-lg">
                <img src={logoSrc(domain)} alt="" aria-hidden width={22} height={22} />
            </span>
            <span className="ak-nm">{name}</span>
            {recommended && <span className="ak-tag">Recommended</span>}
            <ArrowRight className="ak-ar" aria-hidden />
        </button>
    );
}

function SocialRow({
    name,
    domain,
    onClick,
    loading,
}: {
    name: string;
    domain: string;
    onClick: () => void;
    loading: boolean;
}) {
    return (
        <button type="button" onClick={onClick} disabled={loading} className="ak-row">
            {loading ? (
                <Loader2 className="ak-spin" aria-hidden />
            ) : (
                <img src={logoSrc(domain)} alt="" aria-hidden width={20} height={20} />
            )}
            <span className="ak-nm">{name}</span>
        </button>
    );
}

function Steps({ step }: { step: number }) {
    const labels = ["Connect", "Verify", "Enter"];
    return (
        <ol className="ak-steps" aria-label="Sign-in progress">
            {labels.map((label, i) => {
                const done = step > i;
                const active = step === i;
                return (
                    <li
                        key={label}
                        className={done ? "is-done" : active ? "is-on" : undefined}
                        aria-current={active ? "step" : undefined}
                    >
                        <span className="ak-n">{done ? <Check aria-hidden /> : i + 1}</span>
                        {label}
                        {i < labels.length - 1 && <span className="ak-rule" aria-hidden />}
                    </li>
                );
            })}
        </ol>
    );
}

function AuthPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { connected, publicKey, connecting, disconnect, select } = useWallet();
    const { setVisible: openWalletModal } = useWalletModal();
    const { user, isAuthenticated, isLoading, step, error, signIn } = useKeystoneAuth();

    const addLog = useCallback((msg: string) => {
        if (process.env.NODE_ENV !== "production") console.debug("[auth]", msg);
    }, []);

    const [currentStep, setCurrentStep] = useState(0);
    const [showWelcome, setShowWelcome] = useState(false);
    const [socialLoading, setSocialLoading] = useState<string | null>(null);
    const [oauthError, setOauthError] = useState<string | null>(null);

    // ── Invite token (waitlist) ────────────────────────────────────
    const inviteToken = searchParams.get("invite") || "";
    const [inviteState, setInviteState] = useState<
        | { status: "none" }
        | { status: "checking" }
        | { status: "valid"; email?: string }
        | { status: "invalid"; reason: string }
        | { status: "expired" }
        | { status: "used" }
    >(inviteToken ? { status: "checking" } : { status: "none" });

    useEffect(() => {
        if (!inviteToken) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/waitlist/verify?token=${encodeURIComponent(inviteToken)}`);
                const data = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (!data?.ok) {
                    setInviteState({ status: "invalid", reason: "check_failed" });
                    return;
                }
                if (data.expired) { setInviteState({ status: "expired" }); return; }
                if (data.status === "onboarded") { setInviteState({ status: "used" }); return; }
                if (data.valid) setInviteState({ status: "valid", email: data.email });
                else setInviteState({ status: "invalid", reason: data.reason || "invalid" });
            } catch {
                if (!cancelled) setInviteState({ status: "invalid", reason: "network" });
            }
        })();
        return () => { cancelled = true; };
    }, [inviteToken]);

    // Mark waitlist entry as onboarded once auth succeeds
    const inviteConsumed = React.useRef(false);
    useEffect(() => {
        if (!inviteToken || inviteConsumed.current) return;
        if (inviteState.status !== "valid") return;
        if (!isAuthenticated) return;
        inviteConsumed.current = true;
        (async () => {
            try {
                await fetch("/api/waitlist/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token: inviteToken, userId: user?.id }),
                });
            } catch {
                addLog("WARN: INVITE_CONSUME_NETWORK_ERROR");
            }
        })();
    }, [inviteToken, inviteState, isAuthenticated, user?.id, addLog]);

    // OAuth callback errors
    useEffect(() => {
        const err = searchParams.get("error");
        if (err) {
            const messages: Record<string, string> = {
                missing_code: "OAuth callback was missing the authorization code.",
                exchange_failed: "Failed to exchange OAuth code for session.",
                callback_failed: "OAuth callback encountered an error.",
            };
            setOauthError(messages[err] || "An authentication error occurred.");
        }
    }, [searchParams]);

    const postAuthRedirect = searchParams.get("redirect") || "/app";

    // Handle OAuth completion: exchange Neon Auth session for local JWT
    useEffect(() => {
        if (searchParams.get("oauth") !== "complete") return;

        let cancelled = false;
        const exchangeSession = async (attempt = 1) => {
            try {
                const res = await fetch("/api/auth/exchange-session", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });

                if (res.ok && !cancelled) {
                    sessionStorage.removeItem("keystone_oauth_pending");
                    window.location.href = postAuthRedirect;
                    return;
                }

                if (attempt < 2 && !cancelled) {
                    await new Promise((r) => setTimeout(r, 1500));
                    return exchangeSession(attempt + 1);
                }

                if (!cancelled) {
                    const data = await res.json().catch(() => ({}));
                    setOauthError(data.error || "Session exchange failed. Please try signing in again.");
                }
            } catch {
                if (!cancelled) setOauthError("Session exchange failed. Please try signing in again.");
            } finally {
                setSocialLoading(null);
                sessionStorage.removeItem("keystone_oauth_pending");
            }
        };

        exchangeSession();
        return () => { cancelled = true; };
    }, [searchParams, postAuthRedirect]);

    // Existing session → straight to the app
    useEffect(() => {
        let cancelled = false;
        const checkExistingSession = async () => {
            try {
                const siwsRes = await fetch("/api/auth/siws");
                const siwsData = await siwsRes.json().catch(() => null);
                if (!cancelled && siwsData?.user) {
                    window.location.href = postAuthRedirect;
                    return;
                }
                const { data, error: sessErr } = await authClient.getSession();
                if (!cancelled && !sessErr && data?.session) window.location.href = postAuthRedirect;
            } catch {
                /* transient */
            }
        };
        if (searchParams.get("oauth") !== "complete") checkExistingSession();
        return () => { cancelled = true; };
    }, [router, searchParams, postAuthRedirect]);

    // Map auth step to UI step
    useEffect(() => {
        if (isAuthenticated) {
            setCurrentStep(2);
            setShowWelcome(true);
            const timer = setTimeout(() => { window.location.href = postAuthRedirect; }, 1600);
            return () => clearTimeout(timer);
        }
        setCurrentStep(connected && publicKey ? 1 : 0);
    }, [connected, publicKey, isAuthenticated, postAuthRedirect]);

    useEffect(() => {
        if (!isLoading && isAuthenticated) window.location.href = postAuthRedirect;
    }, [isLoading, isAuthenticated, postAuthRedirect]);

    const handleConnectWallet = useCallback(() => {
        openWalletModal(true);
    }, [openWalletModal]);

    const handleRetry = useCallback(() => {
        setOauthError(null);
        if (connected) signIn();
        else openWalletModal(true);
    }, [connected, signIn, openWalletModal]);

    const handleSocialLogin = useCallback(async (provider: "google") => {
        try {
            setSocialLoading(provider);
            setOauthError(null);
            await fetch("/api/auth/exchange-session", { credentials: "include" });
            sessionStorage.setItem("keystone_oauth_pending", provider);
            await authClient.signIn.social({
                provider,
                callbackURL: `${window.location.origin}/auth?oauth=complete`,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setOauthError(msg || `Failed to sign in with ${provider}`);
            setSocialLoading(null);
        }
    }, []);

    const { connect: phantomConnect } = useConnect();

    type PhantomSocialProvider = "google" | "apple";

    const handlePhantomSocial = useCallback(async (provider: PhantomSocialProvider) => {
        setOauthError(null);
        setSocialLoading(`phantom-${provider}`);

        const configuredAppId =
            typeof process !== "undefined" && typeof process.env.NEXT_PUBLIC_PHANTOM_APP_ID === "string"
                ? process.env.NEXT_PUBLIC_PHANTOM_APP_ID
                : undefined;
        if (!configuredAppId || !configuredAppId.trim()) {
            setOauthError(
                "Phantom social sign-in isn't configured for this environment yet (missing app ID). Use wallet sign-in or Google instead.",
            );
            setSocialLoading(null);
            return;
        }

        const phantomRedirectUrl = getPhantomRedirectUrl();
        const phantomOrigin = getPhantomPortalOrigin();

        try {
            sessionStorage.setItem("dreyv_post_auth_redirect", postAuthRedirect);
            sessionStorage.setItem("dreyv_phantom_social_pending", provider);
            await phantomConnect({ provider });
        } catch (err) {
            const raw = err instanceof Error ? err.message : String(err);
            const looksLikeOriginIssue = /login\/start|400|unauthorized|origin|app[_ ]?id/i.test(raw);
            setOauthError(
                looksLikeOriginIssue
                    ? `Phantom rejected the hosted login request. Set Allowed Origin to ${phantomOrigin} and Redirect URL to ${phantomRedirectUrl} exactly for this app ID.`
                    : raw || `Phantom ${provider} sign-in failed.`,
            );
            sessionStorage.removeItem("dreyv_phantom_social_pending");
            setSocialLoading(null);
        }
    }, [phantomConnect, postAuthRedirect]);

    void select;

    const inviteBanner = inviteState.status !== "none" && (
        <div
            className={`ak-note ${
                inviteState.status === "valid"
                    ? "is-ok"
                    : inviteState.status === "checking"
                        ? "is-wait"
                        : "is-warn"
            }`}
        >
            {inviteState.status === "checking" ? (
                <Loader2 className="ak-spin" aria-hidden />
            ) : inviteState.status === "valid" ? (
                <DreyvStar className="mt-[2px] h-3.5 w-3.5 shrink-0" />
            ) : (
                <AlertCircle aria-hidden />
            )}
            <div className="min-w-0">
                {inviteState.status === "checking" && (
                    <p>Verifying your invite…</p>
                )}
                {inviteState.status === "valid" && (
                    <>
                        <p className="ak-note-t">Cohort invite accepted</p>
                        <p className="ak-note-s">
                            {inviteState.email ? `Signed for ${inviteState.email}. ` : ""}Connect a wallet to complete onboarding.
                        </p>
                    </>
                )}
                {inviteState.status === "expired" && (
                    <p>
                        This invite has expired. Reply to your invite email and we&apos;ll send a fresh one.
                    </p>
                )}
                {inviteState.status === "used" && (
                    <p>
                        This invite was already used. Sign in with the wallet you onboarded with.
                    </p>
                )}
                {inviteState.status === "invalid" && (
                    <p>
                        We couldn&apos;t verify this invite link. You can still sign in to the Free tier below.
                    </p>
                )}
            </div>
        </div>
    );

    return (
        <InkFrame>
            <h1 className="ak-sr">Sign in to dreyv</h1>

            <Steps step={currentStep} />

            {/* ─── Step 0 ─────────────────────────────────────── */}
            {currentStep === 0 && !showWelcome && (
                <>
                    <h2 className="ak-h2">Come on in.</h2>
                    <p className="ak-lede">
                        Use a Solana wallet or a social account. New here? An account is created on first sign-in.
                    </p>

                    <div className="ak-stack">
                        {oauthError && (
                            <div className="ak-note is-err">
                                <AlertCircle aria-hidden />
                                <p>{oauthError}</p>
                            </div>
                        )}

                        {inviteBanner}

                        <div className="ak-wallets">
                            <WalletRow name="Phantom" domain="phantom.app" onClick={handleConnectWallet} recommended />
                            <WalletRow name="Solflare" domain="solflare.com" onClick={handleConnectWallet} />
                            <WalletRow name="WalletConnect" domain="walletconnect.com" onClick={handleConnectWallet} />
                        </div>

                        {connecting && (
                            <div className="ak-connecting">
                                <Loader2 className="ak-spin" aria-hidden />
                                <span>Opening your wallet…</span>
                            </div>
                        )}

                        <div className="ak-or">or continue with</div>

                        <div className="ak-social">
                            <SocialRow name="Google" domain="google.com" onClick={() => handleSocialLogin("google")} loading={socialLoading === "google" || socialLoading === "phantom-google"} />
                            <SocialRow name="Apple" domain="apple.com" onClick={() => handlePhantomSocial("apple")} loading={socialLoading === "phantom-apple"} />
                        </div>
                    </div>

                    <p className="ak-fine">
                        Sign in with a Solana wallet, Google, or Phantom. No seed phrases shared, ever.
                    </p>
                </>
            )}

            {/* ─── Step 1 ─────────────────────────────────────── */}
            {currentStep === 1 && !showWelcome && (
                <>
                    <h2 className="ak-h2">Verify it&apos;s you</h2>
                    <p className="ak-lede">
                        Sign a message to prove wallet ownership. This is free and never moves funds.
                    </p>

                    <div className="ak-stack">
                        <div className="ak-wallet">
                            <span className="ak-lg">
                                <Wallet aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="ak-k">Connected</p>
                                <p className="ak-addr">{publicKey?.toBase58()}</p>
                            </div>
                        </div>

                        {step === "signing" && (
                            <div className="ak-status">
                                <PenLine className="animate-pulse motion-reduce:animate-none" aria-hidden />
                                <p>Awaiting signature approval…</p>
                            </div>
                        )}

                        {step === "verifying" && (
                            <div className="ak-status">
                                <Loader2 className="ak-spin" aria-hidden />
                                <p>Verifying signature…</p>
                            </div>
                        )}

                        {step === "error" && error && (
                            <div className="ak-errbox">
                                <div className="ak-note">
                                    <AlertCircle aria-hidden />
                                    <p>{error}</p>
                                </div>
                                <button type="button" onClick={handleRetry} className="ak-retry">
                                    <RefreshCw aria-hidden />
                                    Try again
                                </button>
                            </div>
                        )}

                        {(step === "idle" || step === "connecting") && (
                            <button type="button" onClick={() => signIn()} className="ak-primary">
                                <Lock aria-hidden />
                                <span>Sign &amp; enter dreyv</span>
                                <ArrowRight className="ak-ar" aria-hidden />
                            </button>
                        )}

                        <div className="ak-evm">
                            <p className="ak-k">Optional · EVM read-only</p>
                            <div className="ak-evm-row">
                                <span>
                                    Link an Ethereum / Base wallet for EVM analytics and bridge-for-gas hints.
                                </span>
                                <EvmConnectButton hideUntilMounted={false} />
                            </div>
                        </div>

                        <button type="button" onClick={() => disconnect()} className="ak-link">
                            Cancel &amp; switch wallet
                        </button>
                    </div>
                </>
            )}

            {/* ─── Step 2 ─────────────────────────────────────── */}
            {showWelcome && (
                <div className="ak-done">
                    <span className="ak-seal">
                        <DreyvMark size={30} />
                    </span>
                    <h2 className="ak-h2">You&apos;re in</h2>
                    <p className="ak-lede">Identity verified. Opening your workspace…</p>
                    <span className="ak-pill">
                        <Loader2 className="ak-spin" aria-hidden />
                        Entering dreyv
                    </span>
                </div>
            )}
        </InkFrame>
    );
}

export default function AuthPage() {
    return (
        <Suspense
            fallback={
                <InkFrame>
                    <div className="ak-skel" aria-busy="true">
                        <i className="ak-sk-h" />
                        <i className="ak-sk-l" />
                        <i className="ak-sk-l2" />
                        <i className="ak-sk-r" />
                        <i className="ak-sk-r" />
                        <i className="ak-sk-r" />
                        <div className="ak-sk-s">
                            <i />
                            <i />
                        </div>
                        <p>Preparing secure sign-in…</p>
                    </div>
                </InkFrame>
            }
        >
            <AuthPageContent />
        </Suspense>
    );
}
