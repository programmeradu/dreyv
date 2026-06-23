/**
 * /oauth/device — user-facing device-code verification page.
 *
 * GET shows a user_code entry form (prefilled when ?user_code=... is supplied).
 * Approving issues a same-origin POST to the server action which links the
 * device record to the signed-in user.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { oauthDeviceCodes, oauthClients } from "@/db/schema";
import { SCOPE_LABELS, type OAuthScope } from "@/lib/oauth/scopes";
import { getOAuthUser } from "@/lib/oauth/session";

export const dynamic = "force-dynamic";

async function approveDeviceCode(formData: FormData) {
  "use server";
  const code = String(formData.get("user_code") ?? "")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!code || !db) {
    redirect(`/oauth/device?error=invalid_code`);
  }
  const user = await getOAuthUser();
  if (!user) {
    redirect(`/auth?redirect=${encodeURIComponent(`/oauth/device?user_code=${code}`)}`);
  }
  const normalized = code.includes("-") ? code : `${code.slice(0, 4)}-${code.slice(4)}`;
  const [row] = await db
    .select()
    .from(oauthDeviceCodes)
    .where(and(eq(oauthDeviceCodes.userCode, normalized), gt(oauthDeviceCodes.expiresAt, new Date())))
    .limit(1);
  if (!row) redirect(`/oauth/device?error=unknown_code`);
  if (row.approvedAt || row.deniedAt) redirect(`/oauth/device?error=already_handled`);

  const decision = String(formData.get("decision") ?? "deny");
  if (decision === "allow") {
    await db
      .update(oauthDeviceCodes)
      .set({ approvedUserId: user!.id, approvedAt: new Date() })
      .where(eq(oauthDeviceCodes.deviceCodeHash, row.deviceCodeHash));
    redirect(`/oauth/device?status=approved`);
  } else {
    await db
      .update(oauthDeviceCodes)
      .set({ deniedAt: new Date() })
      .where(eq(oauthDeviceCodes.deviceCodeHash, row.deviceCodeHash));
    redirect(`/oauth/device?status=denied`);
  }
}

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string; error?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const jar = await cookies();
  // Touch cookies() so Next treats this as fully dynamic per-user.
  void jar;
  const user = await getOAuthUser();

  if (sp.status === "approved") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-slate-900">Device connected</h1>
        <p className="mt-3 text-slate-600">
          You can close this tab and return to your application — it should finish signing in within
          a few seconds.
        </p>
      </Shell>
    );
  }
  if (sp.status === "denied") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-slate-900">Request denied</h1>
        <p className="mt-3 text-slate-600">No tokens were issued.</p>
      </Shell>
    );
  }

  const presetCode = (sp.user_code ?? "").toUpperCase().replace(/\s+/g, "");
  let preview: { clientName: string; scopes: OAuthScope[] } | null = null;
  if (presetCode && db) {
    const normalized = presetCode.includes("-")
      ? presetCode
      : `${presetCode.slice(0, 4)}-${presetCode.slice(4)}`;
    const [row] = await db
      .select({
        clientName: oauthClients.clientName,
        scopes: oauthDeviceCodes.scopes,
        expiresAt: oauthDeviceCodes.expiresAt,
      })
      .from(oauthDeviceCodes)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthDeviceCodes.clientId))
      .where(eq(oauthDeviceCodes.userCode, normalized))
      .limit(1);
    if (row && row.expiresAt.getTime() > Date.now()) {
      preview = { clientName: row.clientName, scopes: row.scopes as OAuthScope[] };
    }
  }

  return (
    <Shell>
      <p className="text-sm font-medium uppercase tracking-wide text-violet-700">Connect a device</p>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Enter your code</h1>
      <p className="mt-2 text-sm text-slate-600">
        Your application is showing you a short code. Enter it here to finish connecting it to your
        dreyv account.
      </p>

      {!user ? (
        <p className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-sm text-violet-900">
          You&apos;ll be asked to sign in to dreyv after entering the code.
        </p>
      ) : null}

      {sp.error ? (
        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {sp.error === "unknown_code"
            ? "That code is not valid or has expired."
            : sp.error === "already_handled"
            ? "That code has already been used."
            : "Invalid code."}
        </p>
      ) : null}

      <form action={approveDeviceCode} className="mt-6 space-y-5">
        <label className="block">
          <span className="text-sm font-medium text-slate-800">User code</span>
          <input
            name="user_code"
            defaultValue={presetCode}
            placeholder="XXXX-XXXX"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            className="mt-1 w-full rounded-2xl border border-violet-100 bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.3em] text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
            required
          />
        </label>

        {preview ? (
          <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
            <p className="text-sm font-medium text-slate-900">{preview.clientName}</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {preview.scopes.map((s) => (
                <li key={s} className="break-words">
                  • {(SCOPE_LABELS[s] ?? { title: s }).title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
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
        </div>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-violet-50/40 to-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
        <div className="rounded-3xl border border-violet-100 bg-white p-7 shadow-[0_30px_90px_-40px_rgba(124,58,237,0.35)] sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
