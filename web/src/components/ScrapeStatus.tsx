'use client';

import clsx from 'clsx';
import type { ScrapeRun } from '@prisma/client';
import { relativeDate, sourceLabel } from '@/lib/format';
import ScrapeTrigger from './ScrapeTrigger';
import { useT } from './LocaleProvider';

/**
 * Data-freshness strip.
 *
 * Deliberately quiet. An earlier version spelled out every failure in prose here
 * — which portal broke, what to run to diagnose it — and on a feed where one of
 * six portals is routinely blocked that turned the top of the main screen into a
 * permanent red error message about something the reader cannot act on from this
 * page.
 *
 * What is left is the same information at a glance: one dot per portal, coloured
 * by health, with the full detail (including the error, if any) on hover. Green
 * means listings arrived, amber means the portal answered but sent nothing, red
 * means it failed. `make doctor` is where a diagnosis belongs.
 */

type Health = 'ok' | 'warn' | 'fail' | 'running';

function health(run: ScrapeRun): Health {
  if (run.status === 'FAILED') return 'fail';
  if (run.status === 'RUNNING') return 'running';
  // A run that completed but brought back nothing carries a note in `error` —
  // see SILENT_ZERO_NOTE in the scraper's runner.
  return run.error ? 'warn' : 'ok';
}

const DOT: Record<Health, string> = {
  ok: 'bg-brand-500',
  warn: 'bg-amber-500',
  fail: 'bg-rose-500',
  running: 'bg-sky-500',
};

export default function ScrapeStatus({ runs, running = false }: { runs: ScrapeRun[]; running?: boolean }) {
  const t = useT();
  const newest = runs.length ? runs.reduce((a, b) => (a.startedAt > b.startedAt ? a : b)) : null;

  const title = (run: ScrapeRun, state: Health): string => {
    const when = relativeDate(run.startedAt);
    const source = sourceLabel(run.source);
    if (state === 'fail') return t.scrape.detailFailed(source, run.error ?? '?');
    if (state === 'warn') return `${source}: ${run.error ?? ''}`;
    if (state === 'running') return t.scrape.detailRunning(source, when);
    return t.scrape.detail(source, run.listingsCreated, run.listingsUpdated, when);
  };

  return (
    <div className="mb-6 rounded-2xl bg-surface px-5 py-3 shadow-neu-inset-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ink-500">{t.scrape.updated}</span>
        <span className="text-xs font-semibold text-ink-700">
          {newest ? relativeDate(newest.startedAt) : t.scrape.never}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {runs.map((run) => {
            const state = health(run);
            return (
              <span
                key={run.id}
                className="chip bg-surface !px-2.5 !py-0.5 !text-[10px] text-ink-600 shadow-neu-inset-sm"
                title={title(run, state)}
              >
                <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[state])} />
                {sourceLabel(run.source)}
                {state === 'ok' && run.listingsCreated > 0 && <span className="font-bold">+{run.listingsCreated}</span>}
              </span>
            );
          })}

          <ScrapeTrigger initialRunning={running} />
        </div>
      </div>
    </div>
  );
}
