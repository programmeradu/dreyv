/**
 * OAuth consent screen — server component.
 *
 * Reads the signed pending-request cookie set by GET /api/oauth/authorize and
 * renders client name + requested scopes for the user to approve or deny.
 * Submit posts back to POST /api/oauth/authorize.
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getClient } from "@/lib/oauth/clients";
import { SCOPE_LABELS, type OAuthScope } from "@/lib/oauth/scopes";
import { getOAuthUser } from "@/lib/oauth/session";
import { PENDING_REQUEST_COOKIE, readPendingRequest } from "@/lib/oauth/pending-request";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const jar = await cookies();
  const headersList = await headers();
  const dummyReq = { headers: headersList } as unknown as Request;
  const pending = await readPendingRequest(dummyReq, jar.get(PENDING_REQUEST_COOKIE)?.value);
  if (!pending) {
    return (
      <ConsentShell>
        <h1 className="text-2xl font-semibold text-slate-900">No pending authorization</h1>
        <p className="mt-3 text-slate-600">
          This screen only loads when an MCP client (Claude, ChatGPT, Cursor, etc.) sends you here as
          part of an OAuth flow. Start the connection from your client and you&apos;ll be brought back
          here automatically.
        </p>
      </ConsentShell>
    );
  }

  const user = await getOAuthUser();
  if (!user) {
    redirect(`/auth?redirect=${encodeURIComponent("/oauth/consent")}`);
  }

  const client = await getClient(pending.client_id);
  if (!client) {
    return (
      <ConsentShell>
        <h1 className="text-2xl font-semibold text-slate-900">Unknown client</h1>
        <p className="mt-3 text-slate-600">
          The application that initiated this request is no longer registered. Ask its developer to
          re-register via <code className="font-mono">/api/oauth/register</code>.
        </p>
      </ConsentShell>
    );
  }

  const scopes = pending.scopes as OAuthScope[];

  return (
    <ConsentShell>
      <div className="flex items-start gap-4">
        {client.logoUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={client.logoUri}
            alt=""
            className="h-12 w-12 rounded-2xl border border-violet-100 object-contain"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-100 bg-violet-50 text-lg font-semibold text-violet-700">
            {client.clientName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium uppercase tracking-wide text-violet-700">
            Authorize application
          </p>
          <h1 className="mt-1 break-words text-2xl font-semibold text-slate-900">
            {client.clientName}
          </h1>
          {client.clientUri ? (
            <p className="mt-1 break-all text-sm text-slate-500">{client.clientUri}</p>
          ) : null}
        </div>
      </div>

      <p className="mt-6 text-sm leading-6 text-slate-700">
        <span className="font-medium text-slate-900">{client.clientName}</span> wants to access your
        dreyv account
        {user?.email ? (
          <>
            {" "}as <span className="font-medium text-slate-900">{user.email}</span>
          </>
        ) : (
          <>
            {" "}as wallet{" "}
            <span className="font-mono text-xs text-slate-900">{user?.walletAddress}</span>
          </>
        )}
        . Review what they&apos;re asking for:
      </p>

      <ul className="mt-5 divide-y divide-violet-100 overflow-hidden rounded-2xl border border-violet-100 bg-white">
        {scopes.map((s) => {
          const label = SCOPE_LABELS[s] ?? { title: s, description: "" };
          return (
            <li key={s} className="flex items-start gap-3 p-4">
              <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l4 4 6.6-6.6a1 1 0 011.4 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-slate-900">{label.title}</p>
                <p className="mt-0.5 break-words text-sm leading-5 text-slate-600">
                  {label.description}
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">{s}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 break-all text-xs text-slate-500">
        After approval you&apos;ll be redirected to{" "}
        <span className="font-mono text-slate-700">{pending.redirect_uri}</span>. Dreyv never shares
        your private keys — every signing action still happens in your wallet.
      </p>

      <form method="POST" action="/api/oauth/authorize" className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          name="decision"
          value="deny"
          className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Deny
        </button>
        <button
          type="submit"
          name="decision"
          value="allow"
          className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl bg-violet-600 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700"
        >
          Allow access
        </button>
      </form>
    </ConsentShell>
  );
}

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-violet-50/40 to-white">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-12">
        <div className="rounded-3xl border border-violet-100 bg-white p-7 shadow-[0_30px_90px_-40px_rgba(124,58,237,0.35)] sm:p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          Dreyv OAuth · <a className="underline-offset-2 hover:underline" href="/legal/terms">Terms</a>
          {" · "}
          <a className="underline-offset-2 hover:underline" href="/legal/privacy">Privacy</a>
        </p>
      </div>
    </main>
  );
}
