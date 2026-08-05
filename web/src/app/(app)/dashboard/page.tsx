import Link from 'next/link';
import { Suspense } from 'react';
import FeedControls from '@/components/FeedControls';
import PropertyCard from '@/components/PropertyCard';
import ScrapeStatus from '@/components/ScrapeStatus';
import { describePreferences } from '@/lib/matching';
import { getFeed, getLastScrapeRuns, type FeedSort } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';
import type { UiProperty, UiWorkspace } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Discovery · FindHome' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ws = await resolveWorkspace();

  const page = Number(first(sp.page) ?? 1) || 1;
  const [feed, runs] = await Promise.all([
    getFeed(ws, {
      sort: (first(sp.sort) as FeedSort) ?? 'newest',
      q: first(sp.q),
      status: (first(sp.status) as 'ALL') ?? 'ALL',
      page,
      perPage: 24,
      ignorePreferences: first(sp.ignorePreferences) === 'true',
    }),
    getLastScrapeRuns(),
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
            <h1 className="text-2xl font-black tracking-tight text-ink-900">Discovery</h1>
            <span className="chip-raised">
              <span className={ws.kind === 'PARTY' ? 'h-2 w-2 rounded-full bg-brand-500' : 'h-2 w-2 rounded-full bg-ink-400'} />
              {ws.kind === 'PARTY' ? `Party · ${ws.name}` : 'Solo mode'}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink-500">{describePreferences(feed.preferences)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="chip-raised tabular-nums">
            {feed.total} listing{feed.total === 1 ? '' : 's'}
          </span>
          <Link href="/preferences" className="btn-ghost">
            Edit preferences
          </Link>
        </div>
      </div>

      <Suspense fallback={<div className="skeleton mb-6 h-[74px]" />}>
        <FeedControls />
      </Suspense>

      <ScrapeStatus runs={runs} />

      {feed.items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-base font-bold text-ink-800">No listings match this search.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            Loosen your filters in{' '}
            <Link href="/preferences" className="font-semibold text-brand-700 hover:text-brand-800">
              Preferences
            </Link>
            , tick “Ignore filters” above, or wait for the next scraper run to bring in fresh listings.
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
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="chip-raised tabular-nums">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={qs(page + 1)} className="btn-ghost">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
