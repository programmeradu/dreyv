"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useWallet, useWalletModal } from "@/lib/wallet/compat";
import { useConnect } from "@phantom/react-sdk";
import { useKeystoneAuth } from "@/hooks/useKeystoneAuth";
import { useRouter, useSearchParams } from "next/navigation";
import { Urbanist } from "next/font/google";
import { cn } from "@/lib/utils";

const wordmark = Urbanist({
  subsets: ["latin"],
  weight: "600",
  display: "swap",
  adjustFontFallback: true,
});
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

import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { marketingPrimaryCta } from "@/components/home/marketing-styles";
import { EvmConnectButton } from "@/components/EvmConnectButton";

const LOGO_DEV_TOKEN = "pk_DFEjHHL4QteaMOzcFuSlwg";

const logoSrc = (domain: string) =>
    `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&format=png&size=120&fallback=monogram&theme=light`;

// ─── Left brand panel ───────────────────────────────────────────────
const VALUE_PROPS = [
    "Non-custodial — keys never leave your wallet",
    "300+ treasury capabilities, one workspace",
    "Every agent action logged, priced and reversible",
];

function BrandPanel() {
    return (
        <aside className="relative hidden overflow-hidden bg-violet-600 lg:flex lg:w-[46%] xl:w-[48%]">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.10] mix-blend-luminosity"
                style={{ backgroundImage: `url('/images/auth_bg_minimal_arch_4k.png')` }}
            />

            <div className="relative z-10 flex h-full w-full flex-col justify-between p-10 xl:p-14">
                <div className="flex items-center gap-3">
                    <a href="/" aria-label="dreyv home" className="flex items-center group rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40">
                        <span className={cn(
                            wordmark.className,
                            "text-2xl font-semibold tracking-tight text-white/95 lowercase leading-none group-hover:text-white transition-colors antialiased",
                        )}>
                            dreyv
                        </span>
                    </a>
                </div>

                <div className="min-h-0 py-6">
                    <h2 className="max-w-[16ch] text-[34px] font-extrabold leading-[1.08] tracking-tight text-white xl:text-[42px]">
                        The treasury workspace your agents can actually use.
                    </h2>
                    <ul className="mt-8 space-y-3.5">
                        {VALUE_PROPS.map((v) => (
                            <li key={v} className="flex items-start gap-3">
                                <DreyvStar className="mt-[3px] h-3.5 w-3.5 shrink-0 text-white/85" />
                                <span className="text-[14px] font-medium leading-6 text-white/90">{v}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="flex items-end justify-between gap-6">
                    <p className="max-w-[26ch] text-[12px] font-medium leading-5 text-white/65">
                        Sign in with a Solana wallet, Google, or Phantom. No seed phrases shared, ever.
                    </p>
                    <div className="shrink-0">
                        <DreyvMascot pose="greet" size={132} priority />
                    </div>
                </div>
            </div>
        </aside>
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
        <button
            type="button"
            onClick={onClick}
            className={`group flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                recommended
                    ? "border-violet-300 bg-violet-50 hover:bg-violet-100"
                    : "border-violet-100 bg-white hover:border-violet-200 hover:bg-violet-50/60"
            }`}
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-violet-100 bg-white">
                <img src={logoSrc(domain)} alt="" aria-hidden className="h-6 w-6 object-contain" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-slate-900">{name}</span>
            </span>
            {recommended && (
                <span className="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white">
                    Recommended
                </span>
            )}
            <ArrowRight className="h-4 w-4 shrink-0 text-violet-500 transition-transform group-hover:translate-x-0.5" />
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
        <button
            type="button"
            onClick={onClick}
            disabled={loading}
            className="flex w-full min-w-0 items-center justify-center gap-2 rounded-2xl border border-violet-100 bg-white px-3 py-2.5 transition-colors hover:border-violet-200 hover:bg-violet-50/60 disabled:pointer-events-none disabled:opacity-50"
        >
            {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
            ) : (
                <img src={logoSrc(domain)} alt="" aria-hidden className="h-5 w-5 shrink-0 object-contain" />
            )}
            <span className="min-w-0 truncate text-[13px] font-bold text-slate-700">{name}</span>
        </button>
    );
}

function Steps({ step }: { step: number }) {
    const labels = ["Connect", "Verify", "Enter"];
    return (
        <ol className="mb-6 flex items-center gap-2">
            {labels.map((label, i) => {
                const done = step > i;
                const active = step === i;
                return (
                    <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
                        <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ${
                                done
                                    ? "bg-violet-600 text-white"
                                    : active
                                        ? "border border-violet-600 bg-white text-violet-700"
                                        : "border border-violet-100 bg-white text-slate-400"
                            }`}
                        >
                            {done ? <Check className="h-3 w-3" /> : i + 1}
                        </span>
                        <span
                            className={`truncate text-[11px] font-bold uppercase tracking-wider ${
                                active || done ? "text-violet-700" : "text-slate-400"
                            }`}
                        >
                            {label}
                        </span>
                        {i < labels.length - 1 && (
                            <span className={`h-px flex-1 ${done ? "bg-violet-300" : "bg-violet-100"}`} />
                        )}
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
            className={`flex items-start gap-2.5 rounded-2xl border p-3 ${
                inviteState.status === "valid"
                    ? "border-violet-200 bg-violet-50"
                    : inviteState.status === "checking"
                        ? "border-violet-100 bg-white"
                        : "border-amber-200 bg-amber-50"
            }`}
        >
            {inviteState.status === "checking" ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-violet-600" />
            ) : inviteState.status === "valid" ? (
                <DreyvStar className="mt-1 h-3.5 w-3.5 shrink-0 text-violet-600" />
            ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            )}
            <div className="min-w-0">
                {inviteState.status === "checking" && (
                    <p className="text-[12.5px] font-medium leading-snug text-slate-700">Verifying your invite…</p>
                )}
                {inviteState.status === "valid" && (
                    <>
                        <p className="text-[12.5px] font-bold leading-snug text-violet-800">Cohort invite accepted</p>
                        <p className="mt-0.5 break-words text-[12px] font-medium leading-snug text-slate-600">
                            {inviteState.email ? `Signed for ${inviteState.email}. ` : ""}Connect a wallet to complete onboarding.
                        </p>
                    </>
                )}
                {inviteState.status === "expired" && (
                    <p className="text-[12.5px] font-medium leading-snug text-amber-900">
                        This invite has expired. Reply to your invite email and we&apos;ll send a fresh one.
                    </p>
                )}
                {inviteState.status === "used" && (
                    <p className="text-[12.5px] font-medium leading-snug text-amber-900">
                        This invite was already used. Sign in with the wallet you onboarded with.
                    </p>
                )}
                {inviteState.status === "invalid" && (
                    <p className="text-[12.5px] font-medium leading-snug text-amber-900">
                        We couldn&apos;t verify this invite link. You can still sign in to the Free tier below.
                    </p>
                )}
            </div>
        </div>
    );

    return (
        <div className="flex h-dvh overflow-hidden bg-white font-manrope text-slate-900">
            <BrandPanel />

            <main className="flex h-full flex-1 flex-col items-center justify-center px-5 py-6 sm:px-8 sm:py-10">
                <div className="w-full max-w-[400px]">
                    <h1 className="sr-only">Sign in to dreyv</h1>

                    {/* Mobile brand lockup */}
                    <div className="mb-8 flex flex-col items-center lg:hidden">
                        <a href="/" aria-label="dreyv home" className="flex items-center group rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500/40">
                            <span className={cn(
                                wordmark.className,
                                "text-3xl font-semibold tracking-tight text-violet-700 lowercase leading-none group-hover:text-violet-600 transition-colors antialiased",
                            )}>
                                dreyv
                            </span>
                        </a>
                    </div>

                    <Steps step={currentStep} />

                    {/* ─── Step 0 ─────────────────────────────────────── */}
                    {currentStep === 0 && !showWelcome && (
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-950">
                                    Sign in to dreyv
                                </h2>
                                <p className="text-[14px] font-medium leading-6 text-slate-500">
                                    Use a Solana wallet or a social account. New here? An account is created on first sign-in.
                                </p>
                            </div>

                            {oauthError && (
                                <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                                    <p className="min-w-0 break-words text-[12.5px] font-medium leading-snug text-red-800">
                                        {oauthError}
                                    </p>
                                </div>
                            )}

                            {inviteBanner}

                            <div className="space-y-2">
                                <WalletRow name="Phantom" domain="phantom.app" onClick={handleConnectWallet} recommended />
                                <WalletRow name="Solflare" domain="solflare.com" onClick={handleConnectWallet} />
                                <WalletRow name="WalletConnect" domain="walletconnect.com" onClick={handleConnectWallet} />
                            </div>

                            {connecting && (
                                <div className="flex items-center justify-center gap-2 text-[12.5px] font-semibold text-violet-600">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Opening your wallet…</span>
                                </div>
                            )}

                            <div className="flex items-center gap-3">
                                <span className="h-px flex-1 bg-violet-100" />
                                <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">
                                    or continue with
                                </span>
                                <span className="h-px flex-1 bg-violet-100" />
                            </div>

                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <SocialRow name="Google" domain="google.com" onClick={() => handleSocialLogin("google")} loading={socialLoading === "google" || socialLoading === "phantom-google"} />
                                <SocialRow name="Apple" domain="apple.com" onClick={() => handlePhantomSocial("apple")} loading={socialLoading === "phantom-apple"} />
                            </div>

                        </div>
                    )}

                    {/* ─── Step 1 ─────────────────────────────────────── */}
                    {currentStep === 1 && !showWelcome && (
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-950">
                                    Verify it&apos;s you
                                </h2>
                                <p className="text-[14px] font-medium leading-6 text-slate-500">
                                    Sign a message to prove wallet ownership. This is free and never moves funds.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-violet-100 bg-violet-50 p-3.5">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-white">
                                        <Wallet className="h-4 w-4 text-violet-600" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-violet-600">
                                            Connected
                                        </p>
                                        <p className="mt-0.5 break-all font-mono text-[13px] font-medium leading-snug text-slate-800">
                                            {publicKey?.toBase58()}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {step === "signing" && (
                                <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-violet-100 bg-white py-4">
                                    <PenLine className="h-4 w-4 animate-pulse text-violet-600" />
                                    <p className="text-[13px] font-semibold text-violet-700">Awaiting signature approval…</p>
                                </div>
                            )}

                            {step === "verifying" && (
                                <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-violet-100 bg-white py-4">
                                    <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                                    <p className="text-[13px] font-semibold text-violet-700">Verifying signature…</p>
                                </div>
                            )}

                            {step === "error" && error && (
                                <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-3.5">
                                    <div className="flex items-start gap-2.5">
                                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                                        <p className="min-w-0 break-words text-[12.5px] font-medium leading-snug text-red-900">{error}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleRetry}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white py-2.5 text-[13px] font-bold text-red-700 transition-colors hover:bg-red-50"
                                    >
                                        <RefreshCw className="h-4 w-4" />
                                        Try again
                                    </button>
                                </div>
                            )}

                            {(step === "idle" || step === "connecting") && (
                                <button
                                    type="button"
                                    onClick={() => signIn()}
                                    className={`${marketingPrimaryCta} w-full justify-center rounded-2xl py-3.5 text-[14px]`}
                                >
                                    <Lock className="h-4 w-4 shrink-0" />
                                    <span>Sign &amp; enter dreyv</span>
                                    <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                                </button>
                            )}

                            <div className="rounded-2xl border border-violet-100 bg-white p-3.5">
                                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">
                                    Optional · EVM read-only
                                </p>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                    <span className="min-w-0 max-w-[62%] text-[12px] font-medium leading-snug text-slate-600">
                                        Link an Ethereum / Base wallet for EVM analytics and bridge-for-gas hints.
                                    </span>
                                    <EvmConnectButton hideUntilMounted={false} />
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => disconnect()}
                                className="w-full text-center text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400 transition-colors hover:text-violet-600"
                            >
                                Cancel &amp; switch wallet
                            </button>
                        </div>
                    )}

                    {/* ─── Step 2 ─────────────────────────────────────── */}
                    {showWelcome && (
                        <div className="space-y-4 text-center">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-600">
                                <DreyvMark size={30} className="text-white" />
                            </div>
                            <div className="space-y-1.5">
                                <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-950">
                                    You&apos;re in
                                </h2>
                                <p className="text-[14px] font-medium leading-6 text-slate-500">
                                    Identity verified. Opening your workspace…
                                </p>
                            </div>
                            <div className="inline-flex items-center gap-2 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-2.5 text-[12px] font-extrabold uppercase tracking-[0.18em] text-violet-700">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Entering dreyv
                            </div>
                        </div>
                    )}


                </div>
            </main>
        </div>
    );
}

export default function AuthPage() {
    return (
        <Suspense
            fallback={
                <div className="flex h-dvh overflow-hidden bg-white font-manrope">
                    {/* Left violet panel — mirrors BrandPanel atmosphere */}
                    <div className="relative hidden overflow-hidden bg-violet-600 lg:flex lg:w-[46%] xl:w-[48%]">
                        {/* Ambient glow orbs */}
                        <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-violet-400/30 blur-3xl animate-pulse-glow" />
                        <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-violet-800/40 blur-3xl animate-pulse-glow" style={{ animationDelay: "1.5s" }} />
                        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 rounded-full bg-white/5 blur-2xl" />
                        {/* Wordmark */}
                        <div className="relative z-10 flex h-full w-full flex-col justify-between p-10 xl:p-14">
                            <span className={cn(wordmark.className, "text-2xl font-semibold tracking-tight text-white/95 lowercase leading-none antialiased")}>
                                dreyv
                            </span>
                            {/* Bottom text */}
                            <div className="space-y-2">
                                <div className="h-2 w-48 rounded-full bg-white/15 animate-shimmer" />
                                <div className="h-2 w-32 rounded-full bg-white/10 animate-shimmer" style={{ animationDelay: "0.3s" }} />
                            </div>
                        </div>
                    </div>

                    {/* Right panel — auth form skeleton */}
                    <div className="flex h-full flex-1 flex-col items-center justify-center px-5 py-6 sm:px-8">
                        <div className="w-full max-w-[400px] space-y-8">
                            {/* Mobile wordmark (shown only on mobile) */}
                            <div className="flex justify-center lg:hidden">
                                <span className={cn(wordmark.className, "text-3xl font-semibold tracking-tight text-violet-700 lowercase leading-none antialiased animate-pulse-glow")}>
                                    dreyv
                                </span>
                            </div>

                            {/* Heading skeleton */}
                            <div className="space-y-3">
                                <div className="h-8 w-52 rounded-xl bg-slate-100 animate-shimmer" />
                                <div className="h-4 w-72 rounded-lg bg-slate-100 animate-shimmer" style={{ animationDelay: "0.15s" }} />
                                <div className="h-4 w-60 rounded-lg bg-slate-100 animate-shimmer" style={{ animationDelay: "0.25s" }} />
                            </div>

                            {/* Wallet button skeletons */}
                            <div className="space-y-3">
                                <div className="h-14 w-full rounded-2xl bg-violet-50 border border-violet-100 animate-shimmer" style={{ animationDelay: "0.1s" }} />
                                <div className="h-14 w-full rounded-2xl bg-slate-50 border border-slate-100 animate-shimmer" style={{ animationDelay: "0.2s" }} />
                                <div className="h-14 w-full rounded-2xl bg-slate-50 border border-slate-100 animate-shimmer" style={{ animationDelay: "0.3s" }} />
                            </div>

                            {/* Divider skeleton */}
                            <div className="flex items-center gap-3">
                                <div className="h-px flex-1 bg-violet-100" />
                                <div className="h-3 w-24 rounded bg-slate-100 animate-shimmer" />
                                <div className="h-px flex-1 bg-violet-100" />
                            </div>

                            {/* Social button skeletons */}
                            <div className="grid grid-cols-3 gap-2">
                                <div className="h-11 rounded-xl bg-slate-50 border border-slate-100 animate-shimmer" style={{ animationDelay: "0.1s" }} />
                                <div className="h-11 rounded-xl bg-slate-50 border border-slate-100 animate-shimmer" style={{ animationDelay: "0.2s" }} />
                                <div className="h-11 rounded-xl bg-slate-50 border border-slate-100 animate-shimmer" style={{ animationDelay: "0.3s" }} />
                            </div>

                            {/* Subtle loading label */}
                            <p className="text-center text-[10px] font-extrabold uppercase tracking-[0.24em] text-slate-300 animate-pulse-glow">
                                Preparing secure sign-in…
                            </p>
                        </div>
                    </div>
                </div>
            }
        >
            <AuthPageContent />
        </Suspense>
    );
}
