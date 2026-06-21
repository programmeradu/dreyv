/**
 * /status/[slug]/confirm — Email subscription confirmation.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db";
import { publicApiStatusPages, publicApiStatusSubscribers } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { Check, AlertCircle, ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Confirm subscription",
  robots: { index: false, follow: false },
};

export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ id?: string; token?: string }>;
}) {
  const { slug } = await params;
  const { id, token } = await searchParams;

  let status: "ok" | "invalid" | "already" | "unavailable" = "invalid";
  let pageTitle = slug;

  if (db) {
    const [page] = await db
      .select()
      .from(publicApiStatusPages)
      .where(and(eq(publicApiStatusPages.slug, slug), eq(publicApiStatusPages.isPublic, true)))
      .limit(1);

    if (!page) {
      status = "invalid";
    } else {
      pageTitle = page.title;
      if (id && token) {
        const [sub] = await db
          .select()
          .from(publicApiStatusSubscribers)
          .where(
            and(
              eq(publicApiStatusSubscribers.id, id),
              eq(publicApiStatusSubscribers.pageId, page.id),
              eq(publicApiStatusSubscribers.confirmToken, token),
            ),
          )
          .limit(1);
        if (!sub) {
          status = "invalid";
        } else if (sub.confirmedAt) {
          status = "already";
        } else {
          await db
            .update(publicApiStatusSubscribers)
            .set({ confirmedAt: new Date() })
            .where(
              and(
                eq(publicApiStatusSubscribers.id, id),
                isNull(publicApiStatusSubscribers.confirmedAt),
              ),
            );
          status = "ok";
        }
      }
    }
  } else {
    status = "unavailable";
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 font-manrope flex items-center justify-center px-6">
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[480px] rounded-full bg-violet-300/20 blur-[140px]" />
      </div>

      <div className="relative z-10 max-w-md w-full text-center rounded-3xl border border-violet-200/70 bg-white p-10 shadow-[0_10px_40px_-18px_rgba(124,58,237,0.25)]">
        <DreyvStar size={20} className="mx-auto text-violet-600 mb-5" />

        {status === "ok" && (
          <>
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200 mb-4">
              <Check size={20} className="text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">You&apos;re subscribed</h1>
            <p className="mt-2 text-sm text-slate-600">
              You&apos;ll receive updates when incidents are opened, updated, or resolved on{" "}
              <span className="font-medium text-slate-800">{pageTitle}</span>.
            </p>
          </>
        )}

        {status === "already" && (
          <>
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-violet-50 border border-violet-200 mb-4">
              <Check size={20} className="text-violet-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Already confirmed</h1>
            <p className="mt-2 text-sm text-slate-600">
              Your subscription to {pageTitle} is already active.
            </p>
          </>
        )}

        {status === "invalid" && (
          <>
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-rose-50 border border-rose-200 mb-4">
              <AlertCircle size={20} className="text-rose-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Invalid link</h1>
            <p className="mt-2 text-sm text-slate-600">
              This confirmation link is invalid or has expired. Please subscribe again from the status page.
            </p>
          </>
        )}

        {status === "unavailable" && (
          <>
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-amber-50 border border-amber-200 mb-4">
              <AlertCircle size={20} className="text-amber-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Try again shortly</h1>
            <p className="mt-2 text-sm text-slate-600">
              Subscription service is temporarily unavailable.
            </p>
          </>
        )}

        <Link
          href={`/status/${slug}`}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-900"
        >
          <ArrowLeft size={14} /> Back to {pageTitle}
        </Link>
      </div>
    </div>
  );
}
