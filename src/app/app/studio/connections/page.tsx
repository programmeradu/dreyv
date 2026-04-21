"use client";

/**
 * Dreyv Studio → Connections page.
 * Lists every provider in the gateway catalog with status (connected / not),
 * and lets the user connect, edit, or disconnect via the Key Wizard.
 */

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  Pencil,
  Plug,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeyWizardModal } from "@/components/studio/KeyWizardModal";
import {
  type DreyvConnection,
  type PublicProvider,
  isConnected,
  useDreyvConnections,
} from "@/lib/studio/use-dreyv-connections";
import { toast } from "@/lib/toast-notifications";

const CATEGORY_LABEL: Record<string, string> = {
  rpc: "RPC",
  swap: "Swap",
  data: "Market data",
  staking: "Staking",
  oracle: "Oracle",
  email: "Email",
  messaging: "Messaging",
};

export default function ConnectionsPage() {
  const { providers, connections, loading, error, remove, refresh } =
    useDreyvConnections();
  const [wizardProvider, setWizardProvider] = useState<string | null>(null);
  const [wizardExisting, setWizardExisting] = useState<DreyvConnection | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  function openConnect(p: PublicProvider) {
    setWizardExisting(null);
    setWizardProvider(p.id);
  }

  function openEdit(p: PublicProvider, conn: DreyvConnection) {
    setWizardExisting(conn);
    setWizardProvider(p.id);
  }

  async function handleRemove(conn: DreyvConnection) {
    if (!confirm(`Disconnect ${conn.provider}? Mini-apps using it will stop working.`)) return;
    setRemoving(conn.id);
    try {
      await remove(conn.id);
      toast.success(`Disconnected ${conn.provider}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link
          href="/app/studio"
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" /> Back to Studio
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Connections</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Connect third-party services so your Dreyv mini-apps can call them
            on your treasury&apos;s behalf. Keys are sealed with AES-256-GCM —
            never exposed to the browser.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-zinc-500">
            <Loader2 className="mr-2 size-5 animate-spin" />
            Loading providers…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {providers.map((p) => {
              const conn = isConnected(connections, p.id);
              const isPublic = p.secretFields.length === 0;
              return (
                <div
                  key={p.id}
                  className="group relative rounded-xl border border-white/10 bg-zinc-900/40 p-5 backdrop-blur-sm transition-colors hover:border-violet-500/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-zinc-100">
                          {p.name}
                        </h3>
                        <span className="rounded-md bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                          {CATEGORY_LABEL[p.category] ?? p.category}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-400">
                        {p.description}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {conn ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400 ring-1 ring-emerald-500/20">
                          <CheckCircle2 className="size-3" /> Connected
                        </span>
                      ) : isPublic ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-400 ring-1 ring-sky-500/20">
                          Public API
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800/80 px-2 py-1 text-[11px] font-medium text-zinc-500">
                          <Circle className="size-3" /> Not connected
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <a
                      href={p.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-violet-400"
                    >
                      Docs <ExternalLink className="size-3" />
                    </a>

                    <div className="flex items-center gap-1.5">
                      {conn ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(p, conn)}
                            className="h-7 px-2 text-xs"
                          >
                            <Pencil className="mr-1 size-3" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemove(conn)}
                            disabled={removing === conn.id}
                            className="h-7 px-2 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                          >
                            {removing === conn.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Trash2 className="size-3" />
                            )}
                          </Button>
                        </>
                      ) : isPublic ? (
                        <span className="text-[11px] text-zinc-500">No setup needed</span>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => openConnect(p)}
                          className="h-7 px-3 text-xs"
                        >
                          <Plug className="mr-1 size-3" /> Connect
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <KeyWizardModal
        open={wizardProvider !== null}
        onClose={() => setWizardProvider(null)}
        providerId={wizardProvider}
        existing={wizardExisting}
        onSaved={() => {
          toast.success("Connection saved");
          void refresh();
        }}
      />
    </div>
  );
}
