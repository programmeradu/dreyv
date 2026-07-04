"use client";

/**
 * /app/developer — unified developer onboarding hub.
 *
 * Reuses ApiKeysView (mint / scope picker / install snippets) and adds:
 *   - Webhook manager (create / rotate / test-fire / deliveries)
 *   - Manifest panel (OpenAPI, MCP manifest, .well-known/mcp.json, llms.txt)
 *
 * Dreyv premium light shell:
 *   - white bg + ambient violet-400/300 glows
 *   - manrope, solid violet accents (no fuchsia / gradients)
 *   - flat rounded-3xl cards, violet-100/200 borders
 *   - own scroll container (parent <main> uses md:overflow-hidden)
 */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ApiKeysView } from "@/components/settings/ApiKeysView";
import { WebhooksPanel } from "./webhooks-panel";
import { DreyvStar } from "@/components/studio/DreyvStar";
import {
  KeyRound,
  Webhook,
  FileText,
  ArrowUpRight,
  Copy,
  CheckCircle2,
  Terminal,
  ShieldCheck,
  Gauge,
} from "lucide-react";
import { toast } from "@/lib/toast-notifications";

type Tab = "keys" | "webhooks" | "manifests";

const MANIFESTS = [
  {
    label: "OpenAPI 3.1",
    path: "/openapi.json",
    desc: "Every capability auto-generated from the registry — paste into Postman, Stoplight, openapi-generator.",
  },
  {
    label: "MCP manifest",
    path: "/api/mcp/manifest",
    desc: "Public catalog of MCP tools (no auth). For agent registries and discovery.",
  },
  {
    label: "MCP server endpoint",
    path: "/api/mcp",
    desc: "Streamable HTTP MCP transport. Point Claude Desktop, Cursor, or any MCP client here with a Bearer token.",
  },
  {
    label: ".well-known/mcp.json",
    path: "/.well-known/mcp.json",
    desc: "Standard discovery doc — agents auto-find the MCP server from this origin.",
  },
  {
    label: "llms.txt",
    path: "/llms.txt",
    desc: "Concise capability index for LLM crawlers and model context.",
  },
];

export function DeveloperHubClient() {
  const [tab, setTab] = useState<Tab>("keys");
  const [facts, setFacts] = useState<{ capabilities: number | null; rateLimit: number | null }>({
    capabilities: null,
    rateLimit: null,
  });

  useEffect(() => {
    let cancelled = false;
    // Real capability count from the public manifest; real rate limit from the current key.
    fetch("/api/mcp/manifest", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        const n = Array.isArray(j?.tools) ? j.tools.length : Array.isArray(j?.capabilities) ? j.capabilities.length : null;
        setFacts((f) => ({ ...f, capabilities: n }));
      })
      .catch(() => {});
    fetch("/api/keys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const rpm = Array.isArray(j?.keys) && j.keys.length ? Math.max(...j.keys.map((k: any) => k.rateLimitRpm ?? 0)) : null;
        setFacts((f) => ({ ...f, rateLimit: rpm && rpm > 0 ? rpm : null }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const quickFacts: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string }[] = [
    { icon: Terminal, label: "Capabilities", value: facts.capabilities == null ? "—" : `${facts.capabilities} tools` },
    { icon: Gauge, label: "Rate limit", value: facts.rateLimit == null ? "—" : `${facts.rateLimit} req / min` },
    { icon: ShieldCheck, label: "Auth", value: "Bearer + HMAC" },
  ];

  return (
    <div className="relative h-full overflow-y-auto bg-white font-manrope text-slate-900">
      {/* Ambient violet glow — matches /pricing aesthetic */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[520px] overflow-hidden">
        <div className="absolute left-1/2 top-[-180px] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-violet-400/25 blur-[120px]" />
        <div className="absolute left-[8%] top-[40px] h-[260px] w-[260px] rounded-full bg-violet-300/30 blur-[90px]" />
        <div className="absolute right-[6%] top-[80px] h-[220px] w-[220px] rounded-full bg-violet-300/25 blur-[90px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:px-10">
        {/* Header */}
        <header className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 backdrop-blur">
            <DreyvStar size={11} className="text-violet-600" />
            Developer hub
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Build on the Dreyv API + MCP
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-600">
            One Bearer key powers REST{" "}
            <code className="rounded-md bg-violet-50 px-1.5 py-0.5 font-mono text-[13px] text-violet-700">
              /api/v1
            </code>{" "}
            and MCP{" "}
            <code className="rounded-md bg-violet-50 px-1.5 py-0.5 font-mono text-[13px] text-violet-700">
              /api/mcp
            </code>
            . Sign webhooks with HMAC-SHA256. Publish manifests for any agent runtime.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {quickFacts.map((f) => (
              <div
                key={f.label}
                className="flex items-center gap-3 rounded-2xl border border-violet-100 bg-white/90 px-4 py-3 backdrop-blur"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                  <f.icon size={16} />
                </span>
                <div className="leading-tight">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {f.label}
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{f.value}</div>
                </div>
              </div>
            ))}
          </div>
        </header>

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-1 rounded-2xl border border-violet-100 bg-white/80 p-1 backdrop-blur">
          <TabButton active={tab === "keys"} onClick={() => setTab("keys")} icon={<KeyRound size={13} />}>
            API keys &amp; MCP
          </TabButton>
          <TabButton active={tab === "webhooks"} onClick={() => setTab("webhooks")} icon={<Webhook size={13} />}>
            Webhooks
          </TabButton>
          <TabButton active={tab === "manifests"} onClick={() => setTab("manifests")} icon={<FileText size={13} />}>
            Manifests
          </TabButton>
        </div>

        {/* Panel */}
        <section className="rounded-3xl border border-violet-100 bg-white/95 p-5 backdrop-blur sm:p-7">
          {tab === "keys" ? <ApiKeysView /> : tab === "webhooks" ? <WebhooksPanel /> : <ManifestPanel />}
        </section>

        <footer className="mt-10 mb-6 text-center text-[12px] text-slate-500">
          Need help? Read the{" "}
          <Link href="/developers" className="font-semibold text-violet-700 hover:underline">
            developer docs
          </Link>{" "}
          or explore the{" "}
          <Link href="/developers/mcp" className="font-semibold text-violet-700 hover:underline">
            MCP guide
          </Link>
          .
        </footer>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors sm:flex-none ${
        active
          ? "bg-violet-600 text-white"
          : "text-slate-600 hover:bg-violet-50 hover:text-slate-900"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function ManifestPanel() {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(path: string) {
    const full = `${typeof window !== "undefined" ? window.location.origin : "https://dreyv.com"}${path}`;
    navigator.clipboard.writeText(full).then(() => {
      setCopied(path);
      toast.success("URL copied.");
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="grid gap-3">
      {MANIFESTS.map((m) => (
        <div
          key={m.path}
          className="flex flex-col gap-4 rounded-2xl border border-violet-100 bg-white p-5 sm:flex-row sm:items-start"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-slate-900">{m.label}</span>
              <span className="break-all rounded-md bg-violet-50 px-1.5 py-0.5 font-mono text-[11px] text-violet-700">
                {m.path}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{m.desc}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => copy(m.path)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-violet-50"
            >
              {copied === m.path ? (
                <CheckCircle2 size={12} className="text-emerald-600" />
              ) : (
                <Copy size={12} />
              )}
              Copy URL
            </button>
            <Link
              href={m.path}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700"
            >
              Open <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>
      ))}

      <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-5">
        <div className="mb-2 flex items-center gap-2">
          <DreyvStar size={11} className="text-violet-600" />
          <p className="text-sm font-semibold text-slate-900">Quick MCP install</p>
        </div>
        <p className="text-xs leading-relaxed text-slate-600">
          Add to{" "}
          <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-violet-700">
            ~/.cursor/mcp.json
          </code>{" "}
          or Claude Desktop config — the streaming HTTP transport works with any MCP-compatible
          client. Auth via the Bearer token from your API key.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-violet-100 bg-white p-3 text-[11px] leading-relaxed text-slate-800">
{`{
  "mcpServers": {
    "dreyv": {
      "transport": "http",
      "url": "https://dreyv.com/api/mcp",
      "headers": { "Authorization": "Bearer dk_live_..." }
    }
  }
}`}
        </pre>
      </div>
    </div>
  );
}
