"use client";

/**
 * /mobile/signer?id=<handoffId>
 *
 * Universal sign-and-send surface for any Solana wallet. Loaded by the QR
 * code or universal deeplink emitted by `buildDeeplinks`. Fetches the
 * staged unsigned tx from `/api/mcp/handoff/[id]`, shows human-readable
 * meta, and offers three signing paths:
 *
 *   1. Open in Phantom (phantom://)
 *   2. Open in Solflare (https://solflare.com/ul/...)
 *   3. Open in Backpack (https://backpack.app/ul/...)
 *
 * After the wallet broadcasts, the wallet redirects back here with
 * ?signature=<sig>, which we POST back to the handoff endpoint so the
 * agent that staged it can observe completion.
 */

import { useEffect, useState } from "react";
import { Check, X, ShieldCheck, AlertTriangle, Loader2, ArrowUpRight } from "lucide-react";

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

export default function MobileSignerPage() {
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<HandoffPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const handoffId = url.searchParams.get("id");
    setId(handoffId);
    if (!handoffId) {
      setErr("Missing handoff id in URL. Re-open the link from your agent.");
      return;
    }

    // If a wallet redirected back with ?signature=..., notify the staging API.
    const sig = url.searchParams.get("signature");
    if (sig) {
      fetch(`/api/mcp/handoff/${handoffId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature: sig }),
      }).catch(() => {});
    }

    void load(handoffId);
  }, []);

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

  if (err) return <Screen tone="error" title="Unable to sign" body={err} />;
  if (!data) return <Screen tone="loading" title="Loading transaction…" body="One moment while we fetch the request." />;
  if (data.status === "signed")
    return (
      <Screen
        tone="success"
        title="Transaction signed"
        body={`Signature: ${data.signature?.slice(0, 16)}…`}
      />
    );
  if (data.status === "rejected")
    return <Screen tone="error" title="Rejected" body="You declined this transaction." />;

  const expiresInSec = Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000));
  const phantomUrl = walletDeeplink("phantom", data);
  const solflareUrl = walletDeeplink("solflare", data);
  const backpackUrl = walletDeeplink("backpack", data);

  return (
    <div className="min-h-screen bg-white text-[#0B0C10] flex flex-col">
      <header className="px-6 py-5 border-b border-violet-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-violet-600" />
          <span className="font-bold tracking-tight">dreyv</span>
        </div>
        <span className="text-xs text-violet-600 font-semibold uppercase tracking-widest">
          {data.network === "solana-devnet" ? "Devnet" : "Mainnet"}
        </span>
      </header>

      <main className="flex-1 px-6 py-8 max-w-md mx-auto w-full">
        <p className="text-xs uppercase tracking-widest text-violet-600 font-semibold mb-1">Approve in your wallet</p>
        <h1 className="text-2xl font-bold mb-6 leading-tight">{data.label}</h1>

        <div className="rounded-3xl border border-violet-100 bg-white p-5 mb-6">
          <Row label="Signer" value={short(data.userPublicKey)} mono />
          {data.meta &&
            Object.entries(data.meta).map(([k, v]) => (
              <Row key={k} label={k} value={typeof v === "string" ? v : JSON.stringify(v)} />
            ))}
          <Row label="Expires" value={`${expiresInSec}s`} />
          <Row label="Tx size" value={`${Math.ceil((data.txBase64.length * 3) / 4)} bytes`} />
        </div>

        <div className="space-y-3">
          <DeeplinkButton href={phantomUrl} label="Open in Phantom" />
          <DeeplinkButton href={solflareUrl} label="Open in Solflare" />
          <DeeplinkButton href={backpackUrl} label="Open in Backpack" />
        </div>

        <details className="mt-6 text-xs text-neutral-500">
          <summary className="cursor-pointer">Raw transaction (base64)</summary>
          <pre className="mt-2 break-all whitespace-pre-wrap text-[10px] leading-tight">{data.txBase64}</pre>
        </details>

        <button
          onClick={reject}
          disabled={submitting}
          className="mt-8 w-full py-3 text-sm text-neutral-500 hover:text-red-600 transition"
        >
          Reject transaction
        </button>
      </main>
    </div>
  );
}

function walletDeeplink(wallet: "phantom" | "solflare" | "backpack", data: HandoffPayload): string {
  // We use each wallet's signAndSendTransaction deeplink. The wallet pulls
  // the tx from the Solana Pay transaction-request endpoint and, on success,
  // redirects back to this page with ?signature=<sig> so we can confirm.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const txRequestUrl = `${origin}/api/mcp/handoff/${data.id}/sign`;
  const redirect = `${origin}/mobile/signer?id=${data.id}`;
  const enc = encodeURIComponent;
  if (wallet === "phantom") {
    return `https://phantom.app/ul/v1/signAndSendTransaction?request=${enc(txRequestUrl)}&redirect_link=${enc(redirect)}`;
  }
  if (wallet === "solflare") {
    return `https://solflare.com/ul/v1/signAndSendTransaction?request=${enc(txRequestUrl)}&redirect_link=${enc(redirect)}`;
  }
  return `https://backpack.app/ul/v1/signAndSendTransaction?request=${enc(txRequestUrl)}&redirect_link=${enc(redirect)}`;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline py-2 border-b border-violet-50 last:border-b-0">
      <span className="text-xs text-neutral-500 uppercase tracking-wide">{label}</span>
      <span className={`text-sm text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function DeeplinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="w-full h-14 rounded-2xl bg-violet-600 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition"
    >
      {label}
      <ArrowUpRight size={18} />
    </a>
  );
}

function Screen({ tone, title, body }: { tone: "loading" | "success" | "error"; title: string; body: string }) {
  const Icon = tone === "success" ? Check : tone === "error" ? AlertTriangle : Loader2;
  const color =
    tone === "success" ? "text-emerald-600" : tone === "error" ? "text-red-600" : "text-violet-600";
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <Icon size={56} className={`${color} ${tone === "loading" ? "animate-spin" : ""} mb-4`} />
      <h1 className="text-xl font-bold mb-2">{title}</h1>
      <p className="text-sm text-neutral-500 max-w-sm">{body}</p>
    </div>
  );
}

function short(s: string) {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}
