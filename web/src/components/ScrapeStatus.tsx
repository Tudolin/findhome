import clsx from 'clsx';
import type { ScrapeRun } from '@prisma/client';
import { relativeDate, sourceLabel } from '@/lib/format';
import ScrapeTrigger from './ScrapeTrigger';

/**
 * Data-freshness banner.
 *
 * Portal parsers break — that is a matter of when, not if. Surfacing the last
 * run per source means a failing parser looks like a failing parser, instead
 * of looking like "no new listings this week".
 *
 * Three states per source, not two. A run that errored is FAILED; a run that
 * completed but brought back nothing carries a note in `error` (see
 * SILENT_ZERO_NOTE in the scraper's runner) and shows as a warning, because
 * "200 OK, zero listings" is the failure that hides best.
 */

type Health = 'ok' | 'warn' | 'fail' | 'running';

function health(run: ScrapeRun): Health {
  if (run.status === 'FAILED') return 'fail';
  if (run.status === 'RUNNING') return 'running';
  return run.error ? 'warn' : 'ok';
}

const DOT: Record<Health, string> = {
  ok: 'bg-brand-500',
  warn: 'bg-amber-500',
  fail: 'bg-rose-500',
  running: 'bg-sky-500',
};

function title(run: ScrapeRun, state: Health): string {
  const when = relativeDate(run.startedAt);
  if (state === 'fail') return `${run.source} failed: ${run.error ?? 'unknown error'}`;
  if (state === 'warn') return `${run.source}: ${run.error}`;
  if (state === 'running') return `${run.source}: running since ${when}`;
  return `${run.source}: ${run.listingsCreated} new, ${run.listingsUpdated} refreshed · ${when}`;
}

export default function ScrapeStatus({ runs, running = false }: { runs: ScrapeRun[]; running?: boolean }) {
  const states = new Map(runs.map((run) => [run.id, health(run)]));
  const failed = runs.filter((r) => states.get(r.id) === 'fail');
  const warned = runs.filter((r) => states.get(r.id) === 'warn');
  const newest = runs.length ? runs.reduce((a, b) => (a.startedAt > b.startedAt ? a : b)) : null;

  return (
    <div
      className={clsx(
        'mb-6 rounded-2xl bg-surface px-5 py-3.5',
        failed.length || warned.length ? 'shadow-neu' : 'shadow-neu-inset-sm',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-500">Listings updated</span>
        <span className="text-xs font-semibold text-ink-700">
          {newest ? relativeDate(newest.startedAt) : 'never — no run recorded yet'}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {runs.map((run) => {
            const state = states.get(run.id)!;
            return (
              <span
                key={run.id}
                className={clsx(
                  'chip !px-2.5 !py-0.5 !text-[10px]',
                  state === 'fail' ? 'tint-con' : 'bg-surface text-ink-600 shadow-neu-inset-sm',
                )}
                title={title(run, state)}
              >
                <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[state])} />
                {sourceLabel(run.source)}
                {state === 'ok' && run.listingsCreated > 0 && (
                  <span className="font-bold">+{run.listingsCreated}</span>
                )}
                {state === 'warn' && <span className="font-bold">0</span>}
              </span>
            );
          })}

          <ScrapeTrigger initialRunning={running} />
        </div>
      </div>

      {failed.length > 0 && (
        <p className="mt-2.5 text-xs text-rose-700">
          {failed.length === 1 ? `${sourceLabel(failed[0].source)} failed` : `${failed.length} sources failed`} on the
          last run —
          hover a badge for the error, then run{' '}
          <code className="font-mono">docker compose exec scraper node dist/doctor.js</code> to find out which part of
          the contract moved.
        </p>
      )}

      {warned.length > 0 && (
        <p className="mt-2.5 text-xs text-amber-700">
          {warned.map((r) => sourceLabel(r.source)).join(', ')} completed without errors but returned no listings.
          That usually means the portal changed its query contract rather than that the market went quiet — hover a
          badge, or run <code className="font-mono">make doctor</code>.
        </p>
      )}

      {runs.length === 0 && (
        <p className="mt-2.5 text-xs text-ink-500">
          No scrape has run yet. Press <strong>Scrape now</strong>, or wait for the schedule.
        </p>
      )}
    </div>
  );
}
