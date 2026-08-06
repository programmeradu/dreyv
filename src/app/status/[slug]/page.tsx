/**
 * /status/[slug] — Public status page.
 * Anon SELECT policies cover the underlying tables; we read via drizzle.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import {
  publicApiStatusPages,
  publicApiStatusIncidents,
  publicApiStatusIncidentUpdates,
  publicApiStatusMaintenance,
} from "@/db/schema";
import { and, desc, eq, gte, isNull, or, inArray } from "drizzle-orm";
import { DreyvStar } from "@/components/studio/DreyvStar";
import { marketingPrimaryCtaSm } from "@/components/home/marketing-styles";
import { SubscribeForm } from "./subscribe-form";

export const revalidate = 30;

type Component = {
  id: string;
  name: string;
  status?: string; // operational | degraded | partial_outage | major_outage
};

const IMPACT_LABEL: Record<string, { label: string; tone: string }> = {
  none: { label: "All systems operational", tone: "emerald" },
  operational: { label: "All systems operational", tone: "emerald" },
  degraded: { label: "Degraded performance", tone: "amber" },
  partial_outage: { label: "Partial outage", tone: "orange" },
  major_outage: { label: "Major outage", tone: "rose" },
};

function toneClasses(tone: string) {
  switch (tone) {
    case "emerald":
      return {
        dot: "bg-emerald-500",
        chip: "bg-emerald-50 border-emerald-200 text-emerald-700",
        bar: "from-emerald-400 to-emerald-500",
      };
    case "amber":
      return {
        dot: "bg-amber-500",
        chip: "bg-amber-50 border-amber-200 text-amber-700",
        bar: "from-amber-400 to-amber-500",
      };
    case "orange":
      return {
        dot: "bg-orange-500",
        chip: "bg-orange-50 border-orange-200 text-orange-700",
        bar: "from-orange-400 to-orange-500",
      };
    case "rose":
      return {
        dot: "bg-rose-500",
        chip: "bg-rose-50 border-rose-200 text-rose-700",
        bar: "from-rose-400 to-rose-500",
      };
    default:
      return {
        dot: "bg-slate-400",
        chip: "bg-slate-50 border-slate-200 text-slate-600",
        bar: "from-slate-300 to-slate-400",
      };
  }
}

async function getPage(slug: string) {
  if (!db) return null;
  const [page] = await db
    .select()
    .from(publicApiStatusPages)
    .where(and(eq(publicApiStatusPages.slug, slug), eq(publicApiStatusPages.isPublic, true)))
    .limit(1);
  return page ?? null;
}

async function getIncidents(pageId: string) {
  if (!db) return [] as Array<{ incident: typeof publicApiStatusIncidents.$inferSelect; updates: Array<typeof publicApiStatusIncidentUpdates.$inferSelect> }>;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const incidents = await db
    .select()
    .from(publicApiStatusIncidents)
    .where(
      and(
        eq(publicApiStatusIncidents.pageId, pageId),
        or(
          isNull(publicApiStatusIncidents.resolvedAt),
          gte(publicApiStatusIncidents.startedAt, ninetyDaysAgo),
        ),
      ),
    )
    .orderBy(desc(publicApiStatusIncidents.startedAt))
    .limit(50);

  if (incidents.length === 0) return [];

  const updates = await db
    .select()
    .from(publicApiStatusIncidentUpdates)
    .where(
      inArray(
        publicApiStatusIncidentUpdates.incidentId,
        incidents.map((i) => i.id),
      ),
    )
    .orderBy(desc(publicApiStatusIncidentUpdates.postedAt));

  return incidents.map((incident) => ({
    incident,
    updates: updates.filter((u) => u.incidentId === incident.id),
  }));
}

async function getMaintenance(pageId: string) {
  if (!db) return [];
  const now = new Date();
  return db
    .select()
    .from(publicApiStatusMaintenance)
    .where(
      and(
        eq(publicApiStatusMaintenance.pageId, pageId),
        gte(publicApiStatusMaintenance.scheduledEnd, now),
      ),
    )
    .orderBy(publicApiStatusMaintenance.scheduledStart);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return { title: "Status page not found" };
  return {
    title: `${page.title} — Status`,
    description: page.description ?? `Live operational status for ${page.title}.`,
    alternates: { canonical: `/status/${page.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url: `/status/${page.slug}`,
      title: `${page.title} — Status`,
      description: page.description ?? undefined,
      siteName: page.title,
    },
  };
}

export const runtime = "edge";
export default async function StatusPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();

  const [incidents, maintenance] = await Promise.all([
    getIncidents(page.id),
    getMaintenance(page.id),
  ]);

  const components = (page.components as Component[] | null) ?? [];
  const branding = (page.branding as Record<string, unknown> | null) ?? {};
  const brandName = (typeof branding.name === "string" && branding.name) || page.title;

  const active = incidents.filter((x) => !x.incident.resolvedAt);
  // Roll-up overall status from active incidents (worst impact wins).
  const worstImpact = active.reduce<string>((acc, x) => {
    const order = ["none", "degraded", "partial_outage", "major_outage"];
    return order.indexOf(x.incident.impact) > order.indexOf(acc) ? x.incident.impact : acc;
  }, "none");
  const overall = IMPACT_LABEL[worstImpact] ?? IMPACT_LABEL.none;
  const overallTone = toneClasses(overall.tone);

  return (
    <div className="min-h-screen bg-white text-slate-900 font-manrope">
      {/* Ambient violet glow */}
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[520px] rounded-full bg-violet-300/20 blur-[140px]" />
      </div>

      <header className="relative z-10 border-b border-violet-100 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-6 py-5 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-violet-700">
            <DreyvStar size={14} className="text-violet-600" />
            {brandName}
          </Link>
          <Link href="/" className="text-xs text-slate-500 hover:text-violet-700">
            Powered by Dreyv
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-4xl px-6 pt-12 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
          {page.title}
        </h1>
        {page.description && (
          <p className="mt-3 text-slate-600 max-w-2xl">{page.description}</p>
        )}

        {/* Overall banner */}
        <section
          className={`mt-8 rounded-3xl border p-6 flex items-center justify-between gap-4 ${overallTone.chip}`}
        >
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${overallTone.dot} animate-pulse`} />
            <div>
              <div className="text-sm font-semibold">{overall.label}</div>
              <div className="text-xs opacity-70 mt-0.5">
                Last checked {new Date().toUTCString()}
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-widest opacity-60">
            Live
          </span>
        </section>

        {/* Components */}
        {components.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-4">
              Components
            </h2>
            <div className="rounded-3xl border border-violet-200/60 bg-white divide-y divide-violet-100">
              {components.map((c) => {
                const t = toneClasses(
                  (IMPACT_LABEL[c.status ?? "operational"] ?? IMPACT_LABEL.none).tone,
                );
                const label = IMPACT_LABEL[c.status ?? "operational"]?.label ?? "Operational";
                return (
                  <div key={c.id} className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />
                      <span className="text-sm font-medium text-slate-800">{c.name}</span>
                    </div>
                    <span className="text-xs text-slate-500">{label}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Active incidents */}
        {active.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-4">
              Active incidents
            </h2>
            <div className="space-y-4">
              {active.map(({ incident, updates }) => (
                <IncidentCard key={incident.id} incident={incident} updates={updates} />
              ))}
            </div>
          </section>
        )}

        {/* Maintenance */}
        {maintenance.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-4">
              Scheduled maintenance
            </h2>
            <div className="space-y-3">
              {maintenance.map((m) => (
                <div
                  key={m.id}
                  className="rounded-2xl border border-violet-200/60 bg-white p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">{m.title}</h3>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded">
                      {m.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {new Date(m.scheduledStart).toUTCString()} →{" "}
                    {new Date(m.scheduledEnd).toUTCString()}
                  </p>
                  {m.body && (
                    <p className="mt-3 text-sm text-slate-600 leading-relaxed">{m.body}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* History */}
        <section className="mt-12">
          <h2 className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-4">
            Incident history (90 days)
          </h2>
          <HistorySparkline incidents={incidents.map((x) => x.incident)} />
          <div className="mt-5 space-y-3">
            {incidents
              .filter((x) => x.incident.resolvedAt)
              .slice(0, 10)
              .map(({ incident, updates }) => (
                <IncidentCard key={incident.id} incident={incident} updates={updates} compact />
              ))}
            {incidents.filter((x) => x.incident.resolvedAt).length === 0 && (
              <p className="text-sm text-slate-500">
                No resolved incidents in the last 90 days.
              </p>
            )}
          </div>
        </section>

        {/* Subscribe */}
        <section className="mt-14 rounded-3xl border border-violet-200/70 bg-gradient-to-br from-white to-violet-50/60 p-8">
          <div className="flex items-start gap-3 mb-4">
            <DreyvStar size={14} className="text-violet-600 mt-1" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">Get notified</h2>
              <p className="text-sm text-slate-600 mt-1">
                Email updates when incidents are opened, updated, and resolved.
              </p>
            </div>
          </div>
          <SubscribeForm slug={page.slug} />
        </section>
      </main>

      <footer className="relative z-10 border-t border-violet-100 bg-white/80">
        <div className="mx-auto max-w-4xl px-6 py-6 flex items-center justify-between text-xs text-slate-500">
          <span>© {new Date().getFullYear()} {brandName}</span>
          <Link href="/" className="hover:text-violet-700">
            Powered by Dreyv
          </Link>
        </div>
      </footer>
    </div>
  );
}

function IncidentCard({
  incident,
  updates,
  compact = false,
}: {
  incident: typeof publicApiStatusIncidents.$inferSelect;
  updates: Array<typeof publicApiStatusIncidentUpdates.$inferSelect>;
  compact?: boolean;
}) {
  const t = toneClasses(IMPACT_LABEL[incident.impact]?.tone ?? "slate");
  return (
    <article
      className={
        "rounded-2xl border bg-white p-5 " +
        (compact ? "border-slate-200" : "border-violet-200/60")
      }
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`h-2 w-2 rounded-full ${t.dot}`} />
            <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border ${t.chip}`}>
              {incident.severity}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
              {incident.status}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-slate-900">{incident.title}</h3>
        </div>
        <time className="text-xs text-slate-500 shrink-0">
          {new Date(incident.startedAt).toLocaleString()}
        </time>
      </header>
      {updates.length > 0 && (
        <ol className="mt-4 space-y-3 border-l border-violet-100 pl-4">
          {updates.map((u) => (
            <li key={u.id}>
              <div className="text-[10px] font-mono uppercase tracking-widest text-violet-600 mb-1">
                {u.status} · {new Date(u.postedAt).toLocaleString()}
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">{u.body}</p>
            </li>
          ))}
        </ol>
      )}
      {incident.resolvedAt && (
        <p className="mt-4 text-xs text-emerald-700">
          Resolved {new Date(incident.resolvedAt).toLocaleString()}
        </p>
      )}
    </article>
  );
}

function HistorySparkline({
  incidents,
}: {
  incidents: Array<typeof publicApiStatusIncidents.$inferSelect>;
}) {
  // 90 day bars, green if no incident, tinted by worst impact if any.
  const days = 90;
  const buckets: string[] = Array(days).fill("none");
  const now = Date.now();
  const order = ["none", "degraded", "partial_outage", "major_outage"];
  for (const inc of incidents) {
    const start = new Date(inc.startedAt).getTime();
    const end = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : now;
    for (let t = start; t <= end; t += 86_400_000) {
      const dayIdx = days - 1 - Math.floor((now - t) / 86_400_000);
      if (dayIdx < 0 || dayIdx >= days) continue;
      if (order.indexOf(inc.impact) > order.indexOf(buckets[dayIdx])) {
        buckets[dayIdx] = inc.impact;
      }
    }
  }

  return (
    <div className="rounded-2xl border border-violet-200/60 bg-white p-5">
      <div className="flex items-end gap-[2px] h-10">
        {buckets.map((impact, i) => {
          const tone = toneClasses(IMPACT_LABEL[impact]?.tone ?? "emerald");
          const isClean = impact === "none";
          return (
            <div
              key={i}
              title={`${days - i} days ago${isClean ? " — operational" : ` — ${impact}`}`}
              className={`flex-1 rounded-sm bg-gradient-to-b ${
                isClean ? "from-emerald-300 to-emerald-400" : tone.bar
              }`}
              style={{ height: "100%" }}
            />
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400 font-mono uppercase tracking-widest">
        <span>90 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}
