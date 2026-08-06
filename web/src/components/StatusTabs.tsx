import clsx from 'clsx';
import type { InteractionStatus } from '@prisma/client';
import { STATUS_DOT } from '@/lib/constants';
import { hrefWith, type RawSearchParams } from '@/lib/feed-params';

export type StatusTab = { value: 'REVIEWED' | 'RATED' | InteractionStatus; label: string; count: number };

/**
 * The status strip on "Your homes".
 *
 * Plain anchors for the same reason as Pagination: this navigates the document,
 * so the URL is always what the tab says. Changing tab drops `page`, because
 * landing on page 4 of a bucket that has one page is how a working filter looks
 * broken.
 *
 * Counts come from a single grouped query (`getStatusCounts`), not from loading
 * each bucket — a strip of six tabs must not cost six feed queries.
 */
export default function StatusTabs({
  basePath,
  searchParams,
  tabs,
  active,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  tabs: StatusTab[];
  active: string;
}) {
  return (
    <div className="scrollbar-thin mb-5 flex gap-2 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const selected = tab.value === active;
        const dot = tab.value in STATUS_DOT ? STATUS_DOT[tab.value as InteractionStatus] : null;

        return (
          <a
            key={tab.value}
            href={hrefWith(basePath, searchParams, {
              status: tab.value === 'RATED' ? null : tab.value,
              // "Rated" is a rating filter, not a status — the two are separate
              // parameters, so each tab has to clear the other's.
              rated: tab.value === 'RATED' ? 'true' : null,
              page: null,
            })}
            aria-current={selected ? 'page' : undefined}
            className={clsx(
              'flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-150 ease-neu',
              selected ? 'bg-surface text-brand-700 shadow-neu-inset-sm' : 'bg-surface text-ink-600 shadow-neu-sm hover:text-ink-900',
            )}
          >
            {dot ? (
              <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
            ) : (
              <span aria-hidden>{tab.value === 'RATED' ? '★' : '◆'}</span>
            )}
            {tab.label}
            <span
              className={clsx(
                'tabular-nums text-xs font-black',
                tab.count === 0 ? 'text-ink-300' : selected ? 'text-brand-600' : 'text-ink-400',
              )}
            >
              {tab.count}
            </span>
          </a>
        );
      })}
    </div>
  );
}
