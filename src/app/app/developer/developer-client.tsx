"use client";

/**
 * /app/developer — unified developer onboarding hub.
 *
 * Reuses ApiKeysView (which already covers minting / scope picker / install
 * snippets) and adds:
 *   - Webhook manager (create / rotate / test-fire / deliveries)
 *   - Manifest panel (OpenAPI, MCP manifest, .well-known/mcp.json, llms.txt)
 */
import React, { useState } from "react";
import Link from "next/link";
import { ApiKeysView } from "@/components/settings/ApiKeysView";
import { WebhooksPanel } from "./webhooks-panel";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { KeyRound, Webhook, FileText, ArrowUpRight, Copy, CheckCircle2 } from "lucide-react";
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 font-manrope">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-slate-400">
          <DreyvStar size={12} className="text-violet-500" /> Developer hub
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
          Build on the Dreyv API + MCP
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-2xl">
          One Bearer key powers REST <code className="text-violet-700">/api/v1</code> and MCP{" "}
          <code className="text-violet-700">/api/mcp</code>. Sign webhooks with HMAC-SHA256. Publish manifests for any agent runtime.
        </p>
      </header>

      <div className="mb-6 flex gap-2 border-b border-violet-100">
        <TabButton active={tab === "keys"} onClick={() => setTab("keys")} icon={<KeyRound size={12} />}>
          API keys & MCP
        </TabButton>
        <TabButton active={tab === "webhooks"} onClick={() => setTab("webhooks")} icon={<Webhook size={12} />}>
          Webhooks
        </TabButton>
        <TabButton active={tab === "manifests"} onClick={() => setTab("manifests")} icon={<FileText size={12} />}>
          Manifests
        </TabButton>
      </div>

      {tab === "keys" ? (
        <ApiKeysView />
      ) : tab === "webhooks" ? (
        <WebhooksPanel />
      ) : (
        <ManifestPanel />
      )}
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
      className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
        active ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-700"
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
        <div key={m.path} className="rounded-3xl border border-violet-200 bg-white p-5 flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-slate-900">{m.label}</span>
              <span className="font-mono text-[11px] text-violet-700">{m.path}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{m.desc}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => copy(m.path)}
              className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl border border-violet-200 text-slate-700 hover:bg-violet-50"
            >
              {copied === m.path ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Copy size={12} />}
              Copy URL
            </button>
            <Link
              href={m.path}
              target="_blank"
              className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-xl border border-violet-200 text-violet-700 hover:bg-violet-50"
            >
              Open <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>
      ))}

      <div className="rounded-3xl border border-violet-100 bg-violet-50/40 p-5 text-xs text-slate-600">
        <p className="font-semibold text-slate-900 mb-1">Quick MCP install</p>
        <p>
          Add to <code className="text-violet-700">~/.cursor/mcp.json</code> or Claude Desktop config — the streaming HTTP transport
          works with any MCP-compatible client. Auth via the Bearer token from your API key.
        </p>
      </div>
    </div>
  );
}
