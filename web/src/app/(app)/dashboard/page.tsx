import Link from 'next/link';
import FeedControls from '@/components/FeedControls';
import PropertyCard from '@/components/PropertyCard';
import ScrapeStatus from '@/components/ScrapeStatus';
import { getDictionary } from '@/lib/i18n/server';
import { describePreferences } from '@/lib/matching';
import { getFeed, getFeedFacets, getLastScrapeRuns, isScrapeRunning, type FeedSort } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';
import type { UiProperty, UiWorkspace } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Discovery · FindHome' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | string[] | undefined) => {
  const parsed = Number(first(v));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [ws, t] = await Promise.all([resolveWorkspace(), getDictionary()]);

  const page = Number(first(sp.page) ?? 1) || 1;
  const [feed, runs, scraping, facets] = await Promise.all([
    getFeed(ws, {
      sort: (first(sp.sort) as FeedSort) ?? 'newest',
      q: first(sp.q),
      status: (first(sp.status) as 'ALL') ?? 'ALL',
      page,
      perPage: 24,
      ignorePreferences: first(sp.ignorePreferences) === 'true',
      source: first(sp.source),
      maxPrice: num(sp.maxPrice),
      minBedrooms: num(sp.bedrooms),
      minSqm: num(sp.minSqm),
      neighborhood: first(sp.neighborhood),
      pinnedOnly: first(sp.pinned) === 'true',
    }),
    getLastScrapeRuns(),
    isScrapeRunning(),
    getFeedFacets(ws),
  ]);

  const workspace: UiWorkspace = {
    kind: ws.kind,
    id: ws.partyId ?? 'solo',
    name: ws.name,
    members: ws.members,
    userId: ws.userId,
  };

  const totalPages = Math.max(1, Math.ceil(feed.total / feed.perPage));
  const qs = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const value = first(v);
      if (value) next.set(k, value);
    }
    next.set('page', String(p));
    return `/dashboard?${next.toString()}`;
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-ink-900">{t.dashboard.title}</h1>
            <span className="chip-raised">
              <span
                className={
                  ws.kind === 'PARTY' ? 'h-2 w-2 rounded-full bg-brand-500' : 'h-2 w-2 rounded-full bg-ink-400'
                }
              />
              {ws.kind === 'PARTY' ? t.dashboard.partyBadge(ws.name) : t.dashboard.soloBadge}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink-500">
            {feed.preferences ? describePreferences(feed.preferences) : t.dashboard.noPreferences}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="chip-raised tabular-nums">{t.dashboard.count(feed.total)}</span>
          <Link href="/preferences" className="btn-ghost">
            {t.dashboard.editPreferences}
          </Link>
        </div>
      </div>

      {/* No <Suspense> around this.
          `useSearchParams()` only needs a boundary on a statically prerendered
          page, and this one is force-dynamic. The boundary was re-mounting the
          toolbar on every navigation, which is half of why it stopped
          responding after the first filter change. */}
      <FeedControls sources={facets.sources} neighborhoods={facets.neighborhoods} />

      <ScrapeStatus runs={runs} running={scraping} />

      {feed.items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-base font-bold text-ink-800">{t.dashboard.emptyTitle}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            {t.dashboard.emptyBody}{' '}
            <Link href="/preferences" className="font-semibold text-brand-700 hover:text-brand-800">
              {t.dashboard.emptyPreferences}
            </Link>
            {t.dashboard.emptyRest} <strong>{t.dashboard.emptyScrapeNow}</strong> {t.dashboard.emptyTail}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {feed.items.map((property) => (
            <PropertyCard key={property.id} property={property as unknown as UiProperty} workspace={workspace} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-4">
          {page > 1 ? (
            <Link href={qs(page - 1)} className="btn-ghost">
              {t.dashboard.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="chip-raised tabular-nums">{t.dashboard.pageOf(page, totalPages)}</span>
          {page < totalPages ? (
            <Link href={qs(page + 1)} className="btn-ghost">
              {t.dashboard.next}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
