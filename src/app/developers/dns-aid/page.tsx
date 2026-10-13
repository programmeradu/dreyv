import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/marketing/legacy-chrome";
import { DnsAidPublishButton } from "@/components/developers/DnsAidPublishButton";
import { DNS_AID_RECORDS, DNS_AID_ZONE, svcbValue } from "@/lib/dns-aid/records";
import { DreyvStar } from "@/components/studio/DreyvStar";

export const metadata: Metadata = {
  title: "DNS-AID publisher — Dreyv",
  description:
    "One-click publish of the six DNS-AID SVCB records for dreyv.com to Cloudflare. Team-only.",
  robots: { index: false, follow: false },
};

export default function DnsAidAdminPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
          <DreyvStar className="h-3.5 w-3.5" />
          Internal · Team only
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Publish DNS-AID to <span className="text-violet-700">{DNS_AID_ZONE}</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base text-slate-600">
          This is the one-click version of the manual Cloudflare flow. It calls the Cloudflare API
          with the project&apos;s scoped <code className="rounded bg-violet-50 px-1.5 py-0.5 text-xs">Zone:DNS:Edit</code> token and
          idempotently upserts the six SVCB records below. Safe to re-run — existing records that
          already match are left untouched, stale duplicates are removed.
        </p>

        <section className="mt-10 rounded-3xl border border-violet-200 bg-violet-50/40 p-6">
          <DnsAidPublishButton />
          <p className="mt-4 text-xs text-slate-600">
            Requires <code>CLOUDFLARE_API_TOKEN</code> and <code>CLOUDFLARE_ZONE_ID</code> set as
            project secrets. SVCB records are written with proxy <strong>off</strong> (DNS-only,
            grey cloud) — Cloudflare&apos;s orange-cloud proxy doesn&apos;t support SVCB.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
            Records that will be published
          </h2>
          <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200">
            {DNS_AID_RECORDS.map((r) => (
              <li key={r.name} className="space-y-1 px-4 py-3 font-mono text-xs">
                <div className="font-semibold text-slate-900">{r.name}.{DNS_AID_ZONE}</div>
                <div className="break-all text-slate-600">SVCB 1 {r.target} {svcbValue(r.endpoint)}</div>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-10 text-sm text-slate-600">
          Prefer the manual flow?{" "}
          <Link
            href="https://dash.cloudflare.com/?to=/:account/dreyv.com/dns/records"
            className="font-semibold text-violet-700 underline-offset-4 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Open Cloudflare DNS for dreyv.com
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
