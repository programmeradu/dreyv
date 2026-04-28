"use client";

/**
 * PendingInvitationsPanel — shows pending team invitations issued by the
 * current user/team admin. Lets them copy the invite link or revoke.
 *
 * Source: GET /api/team/[id]/invite (existing endpoint).
 */

import { useEffect, useState } from "react";
import { Copy, Check, Mail, Wallet, Clock, Loader2, MailOpen } from "lucide-react";
import { toast } from "@/lib/toast-notifications";

interface Invitation {
  id: string;
  email: string | null;
  walletAddress: string | null;
  role: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export function PendingInvitationsPanel({ teamId }: { teamId: string | null }) {
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/team/${teamId}/invite`);
        if (!res.ok) {
          if (res.status !== 403) console.warn("[invitations] fetch failed", res.status);
          return;
        }
        const data = await res.json();
        if (!cancelled) setInvites(data.invitations || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? "https://dreyv.com");

  const copyLink = async (token: string, id: string) => {
    const link = `${baseUrl}/accept-team-invite/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      toast.success("Invite link copied");
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      toast.error("Could not copy");
    }
  };

  const pending = invites.filter((i) => !i.acceptedAt && new Date(i.expiresAt) > new Date());
  const expired = invites.filter((i) => !i.acceptedAt && new Date(i.expiresAt) <= new Date());

  if (!teamId) return null;

  return (
    <div className="rounded-3xl border border-violet-200/60 bg-white/80 p-7 shadow-[0_1px_0_0_rgba(124,58,237,0.04),0_24px_48px_-24px_rgba(124,58,237,0.18)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
            Pending invitations
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {pending.length === 0 ? "Everyone’s in." : `${pending.length} waiting to accept`}
          </h3>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
      </div>

      {pending.length === 0 && !loading && (
        <p className="mt-4 text-sm text-slate-500">
          When you invite someone by email or wallet address, they’ll show up here until they accept.
        </p>
      )}

      {pending.length > 0 && (
        <div className="mt-5 space-y-3">
          {pending.map((inv) => {
            const expiresIn = Math.max(
              0,
              Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
            );
            return (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-2xl border border-violet-100 bg-violet-50/30 p-4 transition hover:bg-violet-50/60"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-violet-700 shadow-sm">
                    {inv.email ? <Mail className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {inv.email ?? `${inv.walletAddress?.slice(0, 6)}…${inv.walletAddress?.slice(-4)}`}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                        {inv.role}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {expiresIn === 0 ? "expires today" : `${expiresIn}d left`}
                      </span>
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => copyLink(inv.token, inv.id)}
                  className="flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50"
                >
                  {copiedId === inv.id ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy link
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {expired.length > 0 && (
        <div className="mt-5 border-t border-violet-100 pt-4">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            <MailOpen className="h-3.5 w-3.5" />
            {expired.length} expired
          </p>
        </div>
      )}
    </div>
  );
}
