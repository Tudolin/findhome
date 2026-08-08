import Link from 'next/link';
import FeedControls from '@/components/FeedControls';
import FirstSteps from '@/components/FirstSteps';
import Pagination from '@/components/Pagination';
import PropertyCard from '@/components/PropertyCard';
import ScrapeStatus from '@/components/ScrapeStatus';
import { getDictionary } from '@/lib/i18n/server';
import { describePreferences } from '@/lib/matching';
import { one, parseFilters, parsePage, parsePerPage, parseSort, type RawSearchParams } from '@/lib/feed-params';
import { getFeed, getFeedFacets, getLastScrapeRuns, getReviewSummary, isScrapeRunning } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';
import type { UiProperty, UiWorkspace } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Discovery · FindHome' };

type SearchParams = Promise<RawSearchParams>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [ws, t] = await Promise.all([resolveWorkspace(), getDictionary()]);

  const [feed, runs, scraping, facets, progress] = await Promise.all([
    getFeed(ws, {
      ...parseFilters(sp),
      sort: parseSort(sp, 'newest'),
      page: parsePage(sp),
      perPage: parsePerPage(sp, 24),
    }),
    getLastScrapeRuns(),
    isScrapeRunning(),
    getFeedFacets(ws),
    // Drives the first-steps checklist. Reuses the "Your homes" summary rather
    // than counting again — it already answers exactly these questions.
    getReviewSummary(ws),
  ]);

  const workspace: UiWorkspace = {
    kind: ws.kind,
    id: ws.partyId ?? 'solo',
    name: ws.name,
    members: ws.members,
    userId: ws.userId,
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
            {feed.preferences
              ? // The viewed type, not the saved one — the toolbar's rent/buy
                // toggle changes what the summary is describing.
                describePreferences(feed.preferences, one(sp.listingType) === 'SALE' ? 'SALE' : undefined)
              : t.dashboard.noPreferences}
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
      <FeedControls facets={facets} basePath="/dashboard" />

      {/* Every step is derived from real state, so the panel empties itself as
          the app gets used and then stops rendering. See FirstSteps. */}
      <FirstSteps
        steps={[
          {
            key: 'preferences',
            title: t.guide.stepPreferences,
            body: t.guide.stepPreferencesBody,
            href: '/preferences',
            done: Boolean(feed.preferences),
          },
          {
            key: 'rate',
            title: t.guide.stepRate,
            body: t.guide.stepRateBody,
            done: progress.rated > 0,
          },
          {
            key: 'shortlist',
            title: t.guide.stepShortlist,
            body: t.guide.stepShortlistBody,
            href: '/my-homes',
            done: progress.reviewed > 0,
          },
          {
            key: 'party',
            title: t.guide.stepParty,
            body: t.guide.stepPartyBody,
            href: '/co-op#party',
            done: ws.kind === 'PARTY',
          },
          {
            key: 'visit',
            title: t.guide.stepVisit,
            body: t.guide.stepVisitBody,
            href: '/visits',
            done: progress.upcomingVisits > 0,
          },
        ]}
      />

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

      <Pagination
        basePath="/dashboard"
        searchParams={sp}
        page={feed.page}
        pageCount={feed.pageCount}
        total={feed.total}
        truncated={feed.truncated}
      />
    </>
  );
}
