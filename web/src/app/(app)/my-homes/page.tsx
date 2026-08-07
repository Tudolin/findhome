import Link from 'next/link';
import CompareGrid from '@/components/CompareGrid';
import FeedControls from '@/components/FeedControls';
import Pagination from '@/components/Pagination';
import StatusTabs, { type StatusTab } from '@/components/StatusTabs';
import { money } from '@/lib/format';
import { getDictionary } from '@/lib/i18n/server';
import { one, parseFilters, parsePage, parsePerPage, parseSort, type RawSearchParams } from '@/lib/feed-params';
import { getFeed, getFeedFacets, getReviewSummary, getStatusCounts } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';
import type { UiProperty, UiWorkspace } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your homes · FindHome' };

type SearchParams = Promise<RawSearchParams>;

/**
 * "Your homes" — everything this workspace has actually reacted to.
 *
 * Discovery is a firehose: it shows what the portals published, and a listing you
 * rated four stars last week is 300 cards down by Friday. This screen is the
 * other half — a small, stable set you can sort by *your* judgement rather than
 * by what a portal posted most recently.
 *
 * Two deliberate differences from the Discovery feed:
 *
 *  - Saved preferences are NOT applied. A flat you shortlisted must not vanish
 *    because you later raised your minimum area; the whole point of this screen is
 *    that things you have decided about stop moving.
 *  - The default sort is "recently reviewed", not "newest listing" — the ordering
 *    people expect from a list of their own work.
 */
export default async function MyHomesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [ws, t] = await Promise.all([resolveWorkspace(), getDictionary()]);

  // The tab strip owns `status` here, and every bucket is "something I did".
  // ALL and UNREVIEWED would contradict the screen, and an unknown value from a
  // hand-edited URL must not reach Prisma as an enum — both fold into REVIEWED.
  const BUCKETS = ['REVIEWED', 'INTERESTED', 'FAVORITE', 'VISIT_SCHEDULED', 'APPLIED', 'REJECTED'] as const;
  const requested = one(sp.status);
  const status = (BUCKETS as readonly string[]).includes(requested ?? '')
    ? (requested as (typeof BUCKETS)[number])
    : 'REVIEWED';

  // "Rated" is a rating filter rather than a status, so it is what highlights the
  // tab even though `status` stays REVIEWED underneath.
  const ratedOnly = one(sp.rated) === 'true';
  const activeTab: StatusTab['value'] = ratedOnly ? 'RATED' : status;

  const [feed, facets, counts, summary] = await Promise.all([
    getFeed(ws, {
      ...parseFilters(sp),
      status,
      // Never filtered by the saved profile — see the note above.
      ignorePreferences: true,
      // And never hidden because the ad came down. Losing your own notes and
      // ratings because a portal expired a listing is the opposite of what this
      // screen is for; they stay, badged.
      includeInactive: true,
      sort: parseSort(sp, 'reviewed_desc'),
      page: parsePage(sp),
      perPage: parsePerPage(sp, 24),
    }),
    // Facets over the reviewed set, not the catalogue: this screen ignores the
    // saved profile, so its filter options must too.
    getFeedFacets(ws, 'reviewed'),
    getStatusCounts(ws),
    getReviewSummary(ws),
  ]);

  const workspace: UiWorkspace = {
    kind: ws.kind,
    id: ws.partyId ?? 'solo',
    name: ws.name,
    members: ws.members,
    userId: ws.userId,
  };

  const reviewedTotal =
    counts.INTERESTED + counts.FAVORITE + counts.VISIT_SCHEDULED + counts.APPLIED + counts.REJECTED;

  const tabs: StatusTab[] = [
    { value: 'REVIEWED', label: t.myHomes.tabs.all, count: reviewedTotal },
    { value: 'FAVORITE', label: t.status.FAVORITE, count: counts.FAVORITE },
    { value: 'INTERESTED', label: t.status.INTERESTED, count: counts.INTERESTED },
    { value: 'VISIT_SCHEDULED', label: t.status.VISIT_SCHEDULED, count: counts.VISIT_SCHEDULED },
    { value: 'APPLIED', label: t.status.APPLIED, count: counts.APPLIED },
    { value: 'REJECTED', label: t.status.REJECTED, count: counts.REJECTED },
    { value: 'RATED', label: t.myHomes.tabs.rated, count: counts.RATED },
  ];

  const stats: Array<{ label: string; value: string }> = [
    { label: t.myHomes.stats.reviewed, value: String(summary.reviewed) },
    {
      label: t.myHomes.stats.avgRating,
      value: summary.avgRating === null ? '—' : `${summary.avgRating.toFixed(1)} ★`,
    },
    { label: t.myHomes.stats.pinned, value: String(summary.pinned) },
    { label: t.myHomes.stats.visits, value: String(summary.upcomingVisits) },
    { label: t.myHomes.stats.cheapest, value: money(summary.cheapest) },
    { label: t.myHomes.stats.archived, value: String(summary.archived) },
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-ink-900">{t.myHomes.title}</h1>
            <span className="chip-raised">
              <span
                className={
                  ws.kind === 'PARTY' ? 'h-2 w-2 rounded-full bg-brand-500' : 'h-2 w-2 rounded-full bg-ink-400'
                }
              />
              {ws.kind === 'PARTY' ? t.dashboard.partyBadge(ws.name) : t.dashboard.soloBadge}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-ink-500">{t.myHomes.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="chip-raised tabular-nums">{t.dashboard.count(feed.total)}</span>
          <Link href="/co-op" className="btn-ghost">
            {t.myHomes.openBoard}
          </Link>
        </div>
      </div>

      {reviewedTotal > 0 && (
        <dl className="card mb-6 grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((stat) => (
            <div key={stat.label} className="well-sm px-3 py-2.5">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{stat.label}</dt>
              <dd className="mt-0.5 text-lg font-black tabular-nums text-ink-800">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <StatusTabs basePath="/my-homes" searchParams={sp} tabs={tabs} active={activeTab} />

      {/* `status` is driven by the tabs and preferences never apply here, so both
          of those controls are hidden rather than left to contradict the screen. */}
      <FeedControls facets={facets} basePath="/my-homes" hide={['status', 'ignorePreferences']} />

      {feed.items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-base font-bold text-ink-800">
            {reviewedTotal === 0 ? t.myHomes.emptyTitle : t.myHomes.emptyFilteredTitle}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            {reviewedTotal === 0 ? (
              <>
                {t.myHomes.emptyBody}{' '}
                <Link href="/dashboard" className="font-semibold text-brand-700 hover:text-brand-800">
                  {t.nav.discovery}
                </Link>
                .
              </>
            ) : (
              <>
                {t.myHomes.emptyFilteredBody}{' '}
                <a href="/my-homes" className="font-semibold text-brand-700 hover:text-brand-800">
                  {t.filters.clear}
                </a>
                .
              </>
            )}
          </p>
        </div>
      ) : (
        // Only here, not on Discovery: comparing is something you do to a
        // shortlist you have already narrowed, and a tick box on 2.000 cards is
        // clutter rather than a feature.
        <CompareGrid items={feed.items as unknown as UiProperty[]} workspace={workspace} />
      )}

      <Pagination
        basePath="/my-homes"
        searchParams={sp}
        page={feed.page}
        pageCount={feed.pageCount}
        total={feed.total}
        truncated={feed.truncated}
      />
    </>
  );
}
