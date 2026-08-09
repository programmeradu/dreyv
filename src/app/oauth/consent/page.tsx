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
import { DreyvMascot } from "@/components/brand/dreyv-mascot";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const jar = await cookies();
  const headersList = await headers();
  const dummyReq = { headers: headersList } as unknown as Request;
  const pending = await readPendingRequest(dummyReq, jar.get(PENDING_REQUEST_COOKIE)?.value);
  
  if (!pending) {
    return (
      <ConsentShell>
        <div className="flex flex-col items-center justify-center text-center">
          <DreyvMascot pose="think" size={96} />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">No pending authorization</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            This screen only loads when an MCP client sends you here as part of an OAuth flow. Start the connection from your client and you&apos;ll be brought back here automatically.
          </p>
        </div>
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
        <div className="flex flex-col items-center justify-center text-center">
          <DreyvMascot pose="think" size={96} />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">Unknown client</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            The application that initiated this request is no longer registered. Ask its developer to re-register.
          </p>
        </div>
      </ConsentShell>
    );
  }

  const scopes = pending.scopes as OAuthScope[];

  return (
    <ConsentShell>
      {/* Visual Connection Diagram */}
      <div className="mb-8 flex items-center justify-center gap-6">
        <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] border border-slate-100 bg-white p-3 shadow-sm ring-1 ring-black/5">
          {client.logoUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={client.logoUri} alt={client.clientName} className="h-full w-full object-contain" />
          ) : (
            <span className="text-2xl font-bold tracking-tight text-slate-800">
              {client.clientName.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full bg-violet-400"></span>
            <span className="h-1.5 w-1.5 animate-[pulse_1.5s_ease-in-out_0.2s_infinite] rounded-full bg-violet-500"></span>
            <span className="h-1.5 w-1.5 animate-[pulse_1.5s_ease-in-out_0.4s_infinite] rounded-full bg-violet-600"></span>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-violet-500">Connect</span>
        </div>

        <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] border border-violet-100 bg-violet-50/50 p-2 shadow-sm ring-1 ring-violet-500/10">
          <DreyvMascot pose="greet" size={64} />
        </div>
      </div>

      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Authorize <span className="text-violet-600">{client.clientName}</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          This application would like to connect to your Dreyv account
          {user?.email ? (
            <>{" "}as <span className="font-medium text-slate-900">{user.email}</span></>
          ) : (
            <>{" "}as wallet <span className="font-mono text-xs text-slate-900">{user?.walletAddress}</span></>
          )}.
        </p>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-900">Requested Permissions</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {scopes.map((s) => {
            const label = SCOPE_LABELS[s] ?? { title: s, description: "" };
            return (
              <li key={s} className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 transition-all hover:border-violet-100 hover:shadow-sm">
                <div className="absolute inset-0 bg-gradient-to-r from-violet-50/0 to-violet-50/0 transition-all group-hover:from-violet-50/50"></div>
                <div className="relative flex items-start gap-4">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l4 4 6.6-6.6a1 1 0 011.4 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{label.title}</p>
                    <p className="mt-1 text-sm leading-snug text-slate-500">{label.description}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-8 rounded-2xl bg-slate-50 p-4">
        <p className="text-xs leading-relaxed text-slate-500 text-center">
          Dreyv never shares your private keys. Every on-chain signing action will still happen securely in your own wallet. You will be redirected to <span className="font-mono text-slate-700">{pending.redirect_uri}</span>.
        </p>
      </div>

      <form method="POST" action="/api/oauth/authorize" className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          name="decision"
          value="deny"
          className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          name="decision"
          value="allow"
          className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-600 focus:ring-offset-2"
        >
          Authorize Application
        </button>
      </form>
    </ConsentShell>
  );
}

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      {/* Decorative background blobs */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -left-[10%] -top-[10%] h-[500px] w-[500px] rounded-full bg-violet-400/20 blur-[100px]" />
        <div className="absolute -right-[10%] bottom-[10%] h-[400px] w-[400px] rounded-full bg-fuchsia-400/10 blur-[80px]" />
      </div>
      
      <div className="relative z-10 w-full max-w-lg">
        <div className="overflow-hidden rounded-[2.5rem] border border-white/60 bg-white/80 p-8 shadow-2xl shadow-violet-900/5 backdrop-blur-xl sm:p-10">
          {children}
        </div>
        <div className="mt-8 flex items-center justify-center gap-4 text-xs text-slate-400">
          <span className="font-semibold text-slate-500">Dreyv</span>
          <a href="/legal/terms" className="transition hover:text-slate-600 hover:underline">Terms</a>
          <a href="/legal/privacy" className="transition hover:text-slate-600 hover:underline">Privacy</a>
        </div>
      </div>
    </main>
  );
}
