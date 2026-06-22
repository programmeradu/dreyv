"use client";

/**
 * /mobile/signer?id=<handoffId>
 *
 * Universal sign-and-send surface for any Solana wallet. Works two ways:
 *
 *   1. Desktop: detects installed wallet extensions (Phantom, Solflare,
 *      Backpack) and signs/sends in-browser via the wallet's injected
 *      provider — no redirect, no app store detour.
 *   2. Mobile: scan the on-page QR code with any Solana Pay compatible
 *      wallet (or tap "Open in <wallet>" to deep-link the installed app).
 *
 * On success the wallet returns a `signature`, which we POST back to the
 * handoff so the agent that staged the tx can observe completion.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Check,
  AlertTriangle,
  Loader2,
  ArrowUpRight,
  ShieldCheck,
  Copy,
  Smartphone,
  Monitor,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import QRCode from "qrcode";
import {
  Connection,
  VersionedTransaction,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";

type HandoffPayload = {
  id: string;
  txBase64: string;
  userPublicKey: string;
  label: string;
  network: "solana-mainnet" | "solana-devnet";
  meta: Record<string, unknown> | null;
  status: "pending" | "signed" | "expired" | "rejected";
  signature: string | null;
  expiresAt: number;
};

type WalletId = "phantom" | "solflare" | "backpack";

type WalletDef = {
  id: WalletId;
  name: string;
  brand: string; // bg colour for the logo tile
  logo: string;
  install: string;
  detect: () => unknown | null;
};

const WALLETS: WalletDef[] = [
  {
    id: "phantom",
    name: "Phantom",
    brand: "#AB9FF2",
    logo: "/brand/phantom.svg",
    install: "https://phantom.app/download",
    detect: () =>
      (typeof window !== "undefined" &&
        ((window as any).phantom?.solana?.isPhantom
          ? (window as any).phantom.solana
          : (window as any).solana?.isPhantom
            ? (window as any).solana
            : null)) || null,
  },
  {
    id: "solflare",
    name: "Solflare",
    brand: "#FFEF46",
    logo: "/brand/solflare.svg",
    install: "https://solflare.com/download",
    detect: () =>
      (typeof window !== "undefined" && (window as any).solflare?.isSolflare
        ? (window as any).solflare
        : null) || null,
  },
  {
    id: "backpack",
    name: "Backpack",
    brand: "#E33E3F",
    logo: "/brand/backpack.png",
    install: "https://backpack.app/download",
    detect: () =>
      (typeof window !== "undefined" &&
        ((window as any).backpack?.isBackpack
          ? (window as any).backpack
          : (window as any).xnft?.solana
            ? (window as any).xnft.solana
            : null)) || null,
  },
];

export default function MobileSignerPage() {
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<HandoffPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signingWith, setSigningWith] = useState<WalletId | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Record<WalletId, boolean>>({
    phantom: false,
    solflare: false,
    backpack: false,
  });
  const [mode, setMode] = useState<"device" | "mobile">("device");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Boot: read handoff id, detect wallets, kick off load.
  useEffect(() => {
    const url = new URL(window.location.href);
    const handoffId = url.searchParams.get("id");
    setId(handoffId);
    if (!handoffId) {
      setErr("Missing handoff id in URL. Re-open the link from your agent.");
      return;
    }

    // Wallet redirect-back path (mobile deeplink flow).
    const sig = url.searchParams.get("signature");
    if (sig) {
      fetch(`/api/mcp/handoff/${handoffId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature: sig }),
      }).catch(() => {});
    }

    // Detect installed wallets (give injection a tick to settle).
    const detect = () => {
      const next = { phantom: false, solflare: false, backpack: false } as Record<WalletId, boolean>;
      for (const w of WALLETS) next[w.id] = Boolean(w.detect());
      setInstalled(next);
      // Default to "mobile" on small screens where extensions don't exist.
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) {
        setMode("mobile");
      }
    };
    detect();
    const t = setTimeout(detect, 350);

    void load(handoffId);
    return () => clearTimeout(t);
  }, []);

  // Countdown ticker.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll for remote signing completion (someone signed via mobile QR).
  useEffect(() => {
    if (!id || !data || data.status !== "pending") return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/mcp/handoff/${id}`, { cache: "no-store" });
        if (!r.ok) return;
        const json = (await r.json()) as HandoffPayload;
        if (json.status !== data.status) setData(json);
      } catch {}
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, data]);

  // Generate QR for the universal Solana Pay link.
  useEffect(() => {
    if (!data) return;
    const origin = window.location.origin;
    const solanaPayUrl = `solana:${encodeURIComponent(`${origin}/api/mcp/handoff/${data.id}/sign`)}`;
    QRCode.toDataURL(solanaPayUrl, {
      margin: 1,
      width: 512,
      color: { dark: "#0B0C10", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [data]);

  async function load(handoffId: string) {
    try {
      const r = await fetch(`/api/mcp/handoff/${handoffId}`, { cache: "no-store" });
      if (r.status === 404) {
        setErr("Handoff not found or expired. Ask your agent to re-issue the request.");
        return;
      }
      const json = (await r.json()) as HandoffPayload;
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load handoff.");
    }
  }

  async function reject() {
    if (!id) return;
    setSubmitting(true);
    try {
      await fetch(`/api/mcp/handoff/${id}`, { method: "DELETE" });
      await load(id);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  const signWithExtension = useCallback(
    async (walletId: WalletId) => {
      if (!data || !id) return;
      const def = WALLETS.find((w) => w.id === walletId)!;
      const provider = def.detect() as any;
      if (!provider) {
        window.open(def.install, "_blank", "noopener");
        return;
      }
      setSignError(null);
      setSigningWith(walletId);
      try {
        if (typeof provider.connect === "function") {
          try {
            await provider.connect({ onlyIfTrusted: false });
          } catch {
            // user may have cancelled — still try sign; some wallets auto-connect
          }
        }

        const raw = base64ToBytes(data.txBase64);
        let tx: VersionedTransaction | Transaction;
        try {
          tx = VersionedTransaction.deserialize(raw);
        } catch {
          tx = Transaction.from(raw);
        }

        const endpoint =
          data.network === "solana-devnet" ? clusterApiUrl("devnet") : clusterApiUrl("mainnet-beta");
        const connection = new Connection(endpoint, "confirmed");

        let signature: string | undefined;
        if (typeof provider.signAndSendTransaction === "function") {
          const res = await provider.signAndSendTransaction(tx);
          signature = typeof res === "string" ? res : res?.signature;
        } else if (typeof provider.signTransaction === "function") {
          const signed = await provider.signTransaction(tx);
          const wire =
            signed instanceof VersionedTransaction
              ? signed.serialize()
              : (signed as Transaction).serialize();
          signature = await connection.sendRawTransaction(wire, {
            skipPreflight: false,
            maxRetries: 3,
          });
        } else {
          throw new Error(`${def.name} does not expose a signing method.`);
        }

        if (!signature) throw new Error("Wallet returned no signature.");

        await fetch(`/api/mcp/handoff/${id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ signature }),
        });
        await load(id);
      } catch (e: any) {
        const msg = e?.message ?? "Signing failed.";
        // Phantom / Solflare cancel codes.
        if (e?.code === 4001 || /user rejected|cancell?ed/i.test(msg)) {
          setSignError("You cancelled the signature.");
        } else {
          setSignError(msg);
        }
      } finally {
        setSigningWith(null);
      }
    },
    [data, id],
  );

  const deeplinks = useMemo(() => {
    if (!data || typeof window === "undefined") return null;
    const origin = window.location.origin;
    const enc = encodeURIComponent;
    const request = `${origin}/api/mcp/handoff/${data.id}/sign`;
    const redirect = `${origin}/mobile/signer?id=${data.id}`;
    return {
      phantom: `https://phantom.app/ul/v1/signAndSendTransaction?request=${enc(request)}&redirect_link=${enc(redirect)}`,
      solflare: `https://solflare.com/ul/v1/signAndSendTransaction?request=${enc(request)}&redirect_link=${enc(redirect)}`,
      backpack: `https://backpack.app/ul/v1/signAndSendTransaction?request=${enc(request)}&redirect_link=${enc(redirect)}`,
    };
  }, [data]);

  if (err) return <Screen tone="error" title="Unable to sign" body={err} />;
  if (!data)
    return <Screen tone="loading" title="Loading transaction…" body="One moment while we fetch the request." />;
  if (data.status === "signed")
    return (
      <SuccessScreen
        signature={data.signature}
        network={data.network}
        label={data.label}
        signer={data.userPublicKey}
        meta={data.meta}
      />
    );
  if (data.status === "rejected")
    return <Screen tone="error" title="Transaction rejected" body="You declined this transaction." />;


  const expiresInSec = Math.max(0, Math.floor((data.expiresAt - now) / 1000));
  const expiresHuman = expiresInSec > 60 ? `${Math.floor(expiresInSec / 60)}m ${expiresInSec % 60}s` : `${expiresInSec}s`;
  const expiringSoon = expiresInSec < 60;

  return (
    <div className="min-h-screen bg-[#FAFAFB] text-[#0B0C10] flex flex-col antialiased selection:bg-violet-200">
      {/* Header */}
      <header className="px-6 sm:px-10 h-16 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <Image src="/dreyv-mark.png" alt="Dreyv" width={28} height={28} priority />
          <span className="font-semibold tracking-tight text-[15px]">dreyv</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.14em] px-2.5 py-1 rounded-full ${
              data.network === "solana-devnet"
                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                : "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
            }`}
          >
            {data.network === "solana-devnet" ? "Devnet" : "Mainnet"}
          </span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1040px] mx-auto px-5 sm:px-10 py-10 sm:py-14">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-14 items-start">
          {/* LEFT — request summary */}
          <section>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700 mb-3">
              <ShieldCheck size={13} /> Approve in your wallet
            </div>
            <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight leading-[1.1] mb-2">
              {prettyLabel(data.label)}
            </h1>
            <p className="text-[15px] text-neutral-500 max-w-md">
              Dreyv prepared this transaction. Review the details, then sign with your wallet — nothing
              leaves your device until you approve.
            </p>

            <div className="mt-7 rounded-2xl bg-white ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(11,12,16,0.04),0_8px_24px_-12px_rgba(11,12,16,0.08)] overflow-hidden">
              <DetailRow label="Signer" value={short(data.userPublicKey)} mono copyValue={data.userPublicKey} />
              {data.meta &&
                Object.entries(data.meta).slice(0, 6).map(([k, v]) => (
                  <DetailRow
                    key={k}
                    label={humanKey(k)}
                    value={renderMetaValue(v)}
                    mono={looksLikePubkey(v)}
                    copyValue={typeof v === "string" ? v : undefined}
                  />
                ))}
              <DetailRow
                label="Expires"
                value={expiresHuman}
                accent={expiringSoon ? "warn" : undefined}
              />
              <DetailRow label="Size" value={`${Math.ceil((data.txBase64.length * 3) / 4)} bytes`} last />
            </div>

            <details className="mt-5 group">
              <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 text-[12px] text-neutral-500 hover:text-neutral-800 transition">
                <ChevronDown size={14} className="transition group-open:rotate-180" />
                Raw transaction (base64)
              </summary>
              <pre className="mt-3 rounded-xl bg-neutral-50 ring-1 ring-black/5 p-3 text-[10px] leading-snug font-mono break-all whitespace-pre-wrap text-neutral-600 max-h-40 overflow-auto">
                {data.txBase64}
              </pre>
            </details>

            <button
              onClick={reject}
              disabled={submitting}
              className="mt-8 text-[13px] text-neutral-500 hover:text-red-600 transition disabled:opacity-40"
            >
              Reject transaction
            </button>
          </section>

          {/* RIGHT — sign actions */}
          <section className="lg:sticky lg:top-24">
            <div className="rounded-3xl bg-white ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(11,12,16,0.04),0_20px_60px_-20px_rgba(11,12,16,0.15)] p-5 sm:p-6">
              {/* Mode toggle */}
              <div className="flex p-1 bg-neutral-100 rounded-full text-[13px] font-medium mb-5">
                <button
                  onClick={() => setMode("device")}
                  className={`flex-1 h-9 rounded-full flex items-center justify-center gap-1.5 transition ${
                    mode === "device" ? "bg-white shadow-sm text-[#0B0C10]" : "text-neutral-500"
                  }`}
                >
                  <Monitor size={14} /> This device
                </button>
                <button
                  onClick={() => setMode("mobile")}
                  className={`flex-1 h-9 rounded-full flex items-center justify-center gap-1.5 transition ${
                    mode === "mobile" ? "bg-white shadow-sm text-[#0B0C10]" : "text-neutral-500"
                  }`}
                >
                  <Smartphone size={14} /> Mobile
                </button>
              </div>

              {mode === "device" ? (
                <div className="space-y-2.5">
                  {WALLETS.map((w) => (
                    <WalletButton
                      key={w.id}
                      wallet={w}
                      installed={installed[w.id]}
                      busy={signingWith === w.id}
                      disabled={signingWith !== null && signingWith !== w.id}
                      onClick={() => signWithExtension(w.id)}
                    />
                  ))}

                  {signError && (
                    <div className="mt-3 flex items-start gap-2 text-[13px] text-red-600 bg-red-50 ring-1 ring-red-100 rounded-xl p-3">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <span>{signError}</span>
                    </div>
                  )}

                  <p className="pt-3 text-[12px] text-neutral-500 leading-relaxed">
                    Your wallet extension will open a popup to review and approve. The transaction is sent
                    directly from your wallet — Dreyv never touches your keys.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="rounded-2xl bg-white ring-1 ring-black/[0.06] p-3 shadow-sm">
                    {qrDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qrDataUrl}
                        alt="Scan to sign with mobile wallet"
                        width={232}
                        height={232}
                        className="block rounded-lg"
                      />
                    ) : (
                      <div className="w-[232px] h-[232px] flex items-center justify-center">
                        <Loader2 className="animate-spin text-neutral-400" />
                      </div>
                    )}
                  </div>
                  <p className="mt-4 text-[13px] text-neutral-600 text-center max-w-[260px]">
                    Scan with Phantom, Solflare, Backpack, or any Solana Pay wallet on your phone.
                  </p>

                  <button
                    onClick={copyLink}
                    className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-neutral-500 hover:text-neutral-900 transition"
                  >
                    <Copy size={12} /> {copied ? "Link copied" : "Copy signing link"}
                  </button>

                  {deeplinks && (
                    <div className="mt-5 w-full grid grid-cols-3 gap-2">
                      {WALLETS.map((w) => (
                        <a
                          key={w.id}
                          href={deeplinks[w.id]}
                          className="group flex flex-col items-center gap-1.5 py-3 rounded-xl ring-1 ring-black/[0.06] hover:ring-violet-300 hover:bg-violet-50/40 transition"
                        >
                          <span
                            className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden"
                            style={{ background: w.brand }}
                          >
                            <Image src={w.logo} alt={w.name} width={22} height={22} />
                          </span>
                          <span className="text-[11px] font-medium text-neutral-700 group-hover:text-violet-700">
                            {w.name}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <p className="mt-4 text-center text-[11px] text-neutral-400">
              <ShieldCheck size={11} className="inline -mt-0.5 mr-1" />
              Dreyv never sees your private key. Signing happens entirely in your wallet.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

/* ---------- subcomponents ---------- */

function WalletButton({
  wallet,
  installed,
  busy,
  disabled,
  onClick,
}: {
  wallet: WalletDef;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="group w-full h-14 px-3 rounded-2xl bg-white ring-1 ring-black/[0.07] hover:ring-violet-300 hover:bg-violet-50/40 active:scale-[0.995] transition flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span
        className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
        style={{ background: wallet.brand }}
      >
        <Image src={wallet.logo} alt={wallet.name} width={26} height={26} />
      </span>
      <span className="flex-1 text-left">
        <span className="block text-[14px] font-semibold leading-tight">{wallet.name}</span>
        <span
          className={`block text-[11px] mt-0.5 ${
            installed ? "text-emerald-600" : "text-neutral-400"
          }`}
        >
          {installed ? "Detected · ready to sign" : "Not installed"}
        </span>
      </span>
      <span className="text-neutral-400 group-hover:text-violet-600 transition">
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : installed ? (
          <ArrowUpRight size={16} />
        ) : (
          <ExternalLink size={14} />
        )}
      </span>
    </button>
  );
}

function DetailRow({
  label,
  value,
  mono,
  copyValue,
  accent,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyValue?: string;
  accent?: "warn";
  last?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={`flex items-center justify-between gap-4 px-4 sm:px-5 py-3.5 ${
        last ? "" : "border-b border-black/[0.05]"
      }`}
    >
      <span className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 font-medium">{label}</span>
      <span className="flex items-center gap-2 min-w-0">
        <span
          className={`text-[13.5px] text-right truncate ${mono ? "font-mono" : ""} ${
            accent === "warn" ? "text-amber-600 font-medium" : "text-[#0B0C10]"
          }`}
        >
          {value}
        </span>
        {copyValue && (
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(copyValue);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch {}
            }}
            className="text-neutral-400 hover:text-violet-600 transition shrink-0"
            aria-label="Copy"
          >
            {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
          </button>
        )}
      </span>
    </div>
  );
}

function Screen({
  tone,
  title,
  body,
  signature,
  network,
}: {
  tone: "loading" | "success" | "error";
  title: string;
  body: string;
  signature?: string | null;
  network?: HandoffPayload["network"];
}) {
  const Icon = tone === "success" ? Check : tone === "error" ? AlertTriangle : Loader2;
  const ring =
    tone === "success"
      ? "bg-emerald-50 ring-emerald-100 text-emerald-600"
      : tone === "error"
        ? "bg-red-50 ring-red-100 text-red-600"
        : "bg-violet-50 ring-violet-100 text-violet-600";
  const explorer =
    signature && network
      ? `https://solscan.io/tx/${signature}${network === "solana-devnet" ? "?cluster=devnet" : ""}`
      : null;
  return (
    <div className="min-h-screen bg-[#FAFAFB] flex flex-col items-center justify-center p-6 text-center">
      <div className={`w-16 h-16 rounded-full ring-1 ${ring} flex items-center justify-center mb-5`}>
        <Icon size={28} className={tone === "loading" ? "animate-spin" : ""} />
      </div>
      <h1 className="text-[22px] font-semibold tracking-tight mb-2">{title}</h1>
      {tone === "success" && signature ? (
        <>
          <p className="text-[13px] text-neutral-500 max-w-sm font-mono break-all">{short(signature, 10)}</p>
          {explorer && (
            <a
              href={explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 h-10 px-5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold transition"
            >
              View on Solscan <ArrowUpRight size={14} />
            </a>
          )}
        </>
      ) : (
        <p className="text-[14px] text-neutral-500 max-w-sm">{body}</p>
      )}
    </div>
  );
}

function SuccessScreen({
  signature,
  network,
  label,
  signer,
  meta,
}: {
  signature: string | null;
  network: HandoffPayload["network"];
  label: string;
  signer: string;
  meta: Record<string, unknown> | null;
}) {
  const [copied, setCopied] = useState(false);
  const explorer = signature
    ? `https://solscan.io/tx/${signature}${network === "solana-devnet" ? "?cluster=devnet" : ""}`
    : null;

  async function copySig() {
    if (!signature) return;
    try {
      await navigator.clipboard.writeText(signature);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }

  const metaEntries = meta ? Object.entries(meta).slice(0, 4) : [];

  return (
    <div className="min-h-screen bg-[#FAFAFB] text-[#0B0C10] flex flex-col antialiased selection:bg-violet-200">
      <header className="px-6 sm:px-10 h-16 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <Image src="/dreyv-mark.png" alt="Dreyv" width={28} height={28} priority />
          <span className="font-semibold tracking-tight text-[15px]">dreyv</span>
        </div>
        <span
          className={`text-[10px] font-semibold uppercase tracking-[0.14em] px-2.5 py-1 rounded-full ${
            network === "solana-devnet"
              ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
              : "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
          }`}
        >
          {network === "solana-devnet" ? "Devnet" : "Mainnet"}
        </span>
      </header>

      <main className="flex-1 w-full max-w-[560px] mx-auto px-5 sm:px-8 py-12 sm:py-20">
        {/* Hero check with ambient ring */}
        <div className="relative flex items-center justify-center mb-8">
          <div className="absolute w-44 h-44 rounded-full bg-emerald-400/10 blur-2xl" />
          <div className="absolute w-28 h-28 rounded-full bg-emerald-400/15 animate-ping" style={{ animationDuration: "2.4s" }} />
          <div className="relative w-20 h-20 rounded-full bg-white ring-1 ring-emerald-200 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.45)] flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check size={28} strokeWidth={3} className="text-white" />
            </div>
          </div>
        </div>

        <div className="text-center mb-9">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 mb-3">
            <ShieldCheck size={13} /> Confirmed on-chain
          </div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight leading-[1.1] mb-2">
            Transaction signed
          </h1>
          <p className="text-[14.5px] text-neutral-500 max-w-sm mx-auto">
            {prettyLabel(label)} — sent from your wallet and accepted by the network.
          </p>
        </div>

        {/* Receipt card */}
        <div className="rounded-3xl bg-white ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(11,12,16,0.04),0_20px_60px_-20px_rgba(11,12,16,0.15)] overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-black/[0.05] flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-neutral-500">Signature</span>
            <button
              onClick={copySig}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-500 hover:text-violet-600 transition"
            >
              {copied ? (
                <>
                  <Check size={13} className="text-emerald-600" /> Copied
                </>
              ) : (
                <>
                  <Copy size={13} /> Copy
                </>
              )}
            </button>
          </div>
          <div className="px-5 sm:px-6 py-4">
            <p className="font-mono text-[12.5px] leading-relaxed break-all text-[#0B0C10]">
              {signature ?? "—"}
            </p>
          </div>

          <div className="border-t border-black/[0.05] divide-y divide-black/[0.05]">
            <DetailRow label="Signer" value={short(signer)} mono copyValue={signer} />
            {metaEntries.map(([k, v]) => (
              <DetailRow
                key={k}
                label={humanKey(k)}
                value={renderMetaValue(v)}
                mono={looksLikePubkey(v)}
                copyValue={typeof v === "string" ? v : undefined}
              />
            ))}
            <DetailRow label="Network" value={network === "solana-devnet" ? "Solana Devnet" : "Solana Mainnet"} last />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-7 flex flex-col sm:flex-row gap-2.5">
          {explorer && (
            <a
              href={explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-12 px-5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-semibold transition shadow-[0_10px_30px_-12px_rgba(124,58,237,0.6)]"
            >
              View on Solscan <ArrowUpRight size={15} />
            </a>
          )}
          <button
            onClick={() => window.close()}
            className="flex-1 inline-flex items-center justify-center h-12 px-5 rounded-full bg-white ring-1 ring-black/[0.08] hover:ring-violet-300 hover:bg-violet-50/40 text-[#0B0C10] text-[14px] font-semibold transition"
          >
            Done
          </button>
        </div>

        <p className="mt-6 text-center text-[12px] text-neutral-400">
          You can return to your agent — the result has been delivered.
        </p>
      </main>
    </div>
  );
}


/* ---------- helpers ---------- */

function short(s: string, n = 6) {
  return s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
}

function looksLikePubkey(v: unknown): boolean {
  return typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
}

function renderMetaValue(v: unknown): string {
  if (typeof v === "string") return looksLikePubkey(v) ? short(v) : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function humanKey(k: string): string {
  return k.replace(/[_-]/g, " ").replace(/([A-Z])/g, " $1").replace(/\s+/g, " ").trim();
}

function prettyLabel(label: string): string {
  // Tighten arrows and ellipsis spacing — "Swap So1111... → EPjFWd..." reads better than "Swap So1111…  →  EPjFWd…"
  return label.replace(/\s*->\s*/g, " → ").replace(/\.\.\./g, "…");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
