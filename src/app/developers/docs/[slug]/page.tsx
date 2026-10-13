import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

import { RESOURCE_DOCS, getResourceDoc } from "@/lib/developers/resource-docs";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { DreyvMascot } from "@/components/brand/dreyv-mascot";
import { CodeBlock } from "@/components/ui/code-block";

export function generateStaticParams() {
  return RESOURCE_DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = getResourceDoc(slug);
  if (!doc) return { title: "Resource not found · dreyv" };
  return {
    title: `${doc.label} · dreyv developers`,
    description: doc.tagline,
    openGraph: {
      title: `${doc.label} · dreyv developers`,
      description: doc.tagline,
    },
  };
}

export default async function ResourceDocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = getResourceDoc(slug);
  if (!doc) notFound();

  const related = doc.relatedSlugs
    .map((s) => getResourceDoc(s))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  return (
    <main className="relative min-h-screen overflow-hidden bg-white text-zinc-900 font-[var(--font-manrope)]">
      {/* Ambient violet glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-violet-400/25 blur-[140px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[40%] -right-32 h-[380px] w-[380px] rounded-full bg-violet-300/30 blur-[120px]"
      />

      <div className="relative mx-auto w-full max-w-5xl px-6 pt-12 pb-24 sm:pt-16">
        {/* Breadcrumb */}
        <Link
          href="/developers"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-violet-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to developers
        </Link>

        {/* Hero */}
        <header className="mt-8 grid grid-cols-1 items-start gap-10 md:grid-cols-[1fr_220px]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-3 py-1 text-xs font-medium text-violet-700 backdrop-blur">
              <DreyvStar className="text-violet-600" size={12} />
              {doc.short}
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-zinc-900 sm:text-5xl">
              {doc.title}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-zinc-600">
              {doc.tagline}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href={doc.endpoint}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700"
              >
                Open {doc.endpoint}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs text-zinc-600">
                <span className="font-mono text-violet-700">{doc.contentType}</span>
              </span>
            </div>
          </div>

          <div className="relative mx-auto md:mx-0">
            <div className="absolute inset-0 -z-10 rounded-3xl bg-violet-300/30 blur-2xl" />
            <Image
              src={doc.crystal}
              alt={`${doc.label} crystal`}
              width={220}
              height={220}
              className="h-44 w-44 object-contain sm:h-52 sm:w-52"
              priority
            />
          </div>
        </header>

        {/* What / Why */}
        <section className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2">
          <article className="rounded-3xl border border-violet-100 bg-white p-7">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-violet-700">
              <DreyvStar size={12} /> What it is
            </h2>
            <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-zinc-700">
              {doc.what.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </article>
          <article className="rounded-3xl border border-violet-100 bg-white p-7">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-violet-700">
              <DreyvStar size={12} /> Why it matters
            </h2>
            <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-zinc-700">
              {doc.why.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </article>
        </section>

        {/* Curl */}
        <section className="mt-10 rounded-3xl border border-violet-100 bg-white p-7">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-violet-700">
              Try it
            </h2>
            <span className="font-mono text-xs text-slate-400">bash</span>
          </div>
          <CodeBlock wrap>{doc.curl}</CodeBlock>
        </section>

        {/* Optional mascot accent */}
        {doc.mascot && (
          <section className="mt-12 flex items-center gap-6 rounded-3xl border border-violet-100 bg-white p-6">
            <DreyvMascot pose={doc.mascot} size={88} />
            <p className="text-sm leading-relaxed text-zinc-600">
              Need help wiring this into your agent? The{" "}
              <Link href="/developers" className="text-violet-700 underline-offset-4 hover:underline">
                developers overview
              </Link>{" "}
              has the full stack — OpenAPI, ACP, x402, and the agent wallet — in one place.
            </p>
          </section>
        )}

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-16">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Related resources
            </h2>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/developers/docs/${r.slug}`}
                  className="group rounded-2xl border border-violet-100 bg-white p-5 transition hover:border-violet-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-violet-700">
                        {r.short}
                      </div>
                      <div className="mt-2 text-base font-semibold text-zinc-900">
                        {r.label}
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-zinc-400 transition group-hover:text-violet-700" />
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-600 line-clamp-3">
                    {r.tagline}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
