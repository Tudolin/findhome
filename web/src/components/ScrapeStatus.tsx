import clsx from 'clsx';
import type { ScrapeRun } from '@prisma/client';
import { relativeDate } from '@/lib/format';

/**
 * Data-freshness banner.
 *
 * Portal parsers break — that is a matter of when, not if. Surfacing the last
 * run per source means a failing parser looks like a failing parser, instead
 * of looking like "no new listings this week".
 */
export default function ScrapeStatus({ runs }: { runs: ScrapeRun[] }) {
  if (runs.length === 0) return null;

  const failed = runs.filter((r) => r.status === 'FAILED');
  const newest = runs.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));

  return (
    <div className={clsx('mb-6 rounded-2xl bg-surface px-5 py-3.5', failed.length ? 'shadow-neu' : 'shadow-neu-inset-sm')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-500">Listings updated</span>
        <span className="text-xs font-semibold text-ink-700">{relativeDate(newest.startedAt)}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {runs.map((run) => (
            <span
              key={run.id}
              className={clsx(
                'chip !px-2.5 !py-0.5 !text-[10px]',
                run.status === 'FAILED' ? 'tint-con' : 'bg-surface text-ink-600 shadow-neu-inset-sm',
              )}
              title={
                run.status === 'FAILED'
                  ? `${run.source} failed: ${run.error ?? 'unknown error'}`
                  : `${run.source}: ${run.listingsCreated} new, ${run.listingsUpdated} refreshed · ${relativeDate(run.startedAt)}`
              }
            >
              <span
                className={clsx(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  run.status === 'FAILED' ? 'bg-rose-500' : run.status === 'RUNNING' ? 'bg-amber-500' : 'bg-brand-500',
                )}
              />
              {run.source.replace('_', ' ')}
              {run.status === 'SUCCESS' && run.listingsCreated > 0 && (
                <span className="font-bold">+{run.listingsCreated}</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {failed.length > 0 && (
        <p className="mt-2.5 text-xs text-rose-700">
          {failed.length === 1 ? `${failed[0].source} failed` : `${failed.length} sources failed`} on the last run —
          hover a badge for the error, or check <code className="font-mono">docker compose logs scraper</code>.
        </p>
      )}
    </div>
  );
}
