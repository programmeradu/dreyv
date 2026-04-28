"use client";

/**
 * TeamSwitcher — compact dropdown listing the user's teams, with a "Create team" affordance.
 * Used in the app shell so users can quickly hop between teams without a full page nav.
 */

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check, Plus, Users, Loader2 } from "lucide-react";
import { useTeam } from "@/lib/hooks/useTeam";
import { toast } from "@/lib/toast-notifications";

export function TeamSwitcher({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { teams, activeTeam, isLoading, createTeam, refresh } = useTeam();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingName, setCreatingName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handleCreate = async () => {
    if (!creatingName.trim() || submitting) return;
    setSubmitting(true);
    try {
      const id = await createTeam(creatingName.trim());
      if (id) {
        toast.success(`Team “${creatingName.trim()}” created`);
        setCreatingName("");
        setCreating(false);
        setOpen(false);
        router.push("/app/team");
      } else {
        toast.error("Could not create team");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 rounded-xl border border-violet-200/70 bg-white px-3 py-1.5 text-xs text-slate-500 ${className}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading teams…
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-violet-200/70 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50/40"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-600 text-white">
          <Users className="h-3 w-3" />
        </span>
        <span className="max-w-[140px] truncate">
          {activeTeam?.teamName ?? "No team yet"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-violet-200/70 bg-white shadow-[0_24px_48px_-24px_rgba(124,58,237,0.25)]">
          <div className="border-b border-violet-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600">
            Your teams
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {teams.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-500">
                You’re not on a team yet.
              </div>
            ) : (
              teams.map((t) => {
                const isActive = activeTeam?.teamId === t.teamId;
                return (
                  <button
                    key={t.teamId}
                    onClick={() => {
                      setOpen(false);
                      router.push("/app/team");
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-violet-50"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
                      <Users className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 truncate">
                      <span className="block truncate font-medium">{t.teamName}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {t.role} · {t.vaultAddress ? `${t.vaultAddress.slice(0, 6)}…` : "no vault"}
                      </span>
                    </span>
                    {isActive && <Check className="h-3.5 w-3.5 text-violet-600" />}
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-violet-100 p-2">
            {creating ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={creatingName}
                  onChange={(e) => setCreatingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") setCreating(false);
                  }}
                  placeholder="New team name"
                  className="flex-1 rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none"
                />
                <button
                  onClick={handleCreate}
                  disabled={submitting || !creatingName.trim()}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
                >
                  {submitting ? "…" : "Create"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-violet-700 transition hover:bg-violet-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Create new team
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
