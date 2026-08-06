import { getDictionary } from '@/lib/i18n/server';
import { hrefWith, type RawSearchParams } from '@/lib/feed-params';

/**
 * Feed pagination.
 *
 * ## Why these are plain <a> and not next/link
 *
 * They used to be `<Link>`, and paging was unreliable in exactly the way this
 * project already documented for the filter toolbar (see the long note in
 * FeedControls.tsx): for some target URLs the client router performed no
 * navigation at all and left the address bar untouched, so "Next" appeared to do
 * nothing. The toolbar was rewritten as a GET form for that reason; the
 * pagination links were left behind and kept the bug.
 *
 * A plain anchor removes the question. The browser performs the navigation, so
 * the URL is exactly what the href says, every time. The cost is a document
 * navigation instead of a soft one, which this page pays anyway — `/dashboard` is
 * `force-dynamic`, so every page change re-renders on the server regardless.
 *
 * ## Why a window of numbers
 *
 * Prev/Next alone made it impossible to tell how far in you were or to jump, and
 * on a 60-page feed that is most of the navigation. The window keeps first and
 * last always reachable so paging never becomes a one-way trip.
 */

const WINDOW = 2;

/** [1, …, 4, 5, 6, …, 20] — nulls are the ellipses. */
function windowedPages(page: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const pages = new Set<number>([1, pageCount]);
  for (let p = page - WINDOW; p <= page + WINDOW; p += 1) {
    if (p >= 1 && p <= pageCount) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push(null);
    out.push(p);
    previous = p;
  }
  return out;
}

export default async function Pagination({
  basePath,
  searchParams,
  page,
  pageCount,
  total,
  truncated = false,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  page: number;
  pageCount: number;
  total: number;
  /** Set when the ranking window hides rows beyond the last offered page. */
  truncated?: boolean;
}) {
  const t = await getDictionary();
  if (pageCount <= 1 && !truncated) return null;

  const href = (p: number) => hrefWith(basePath, searchParams, { page: p === 1 ? null : p });
  const numbers = windowedPages(page, pageCount);

  return (
    <nav aria-label={t.pagination.label} className="mt-8 space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {page > 1 ? (
          <a href={href(page - 1)} rel="prev" className="btn-ghost !py-2">
            {t.dashboard.previous}
          </a>
        ) : (
          <span aria-hidden className="btn-ghost !py-2 pointer-events-none opacity-40">
            {t.dashboard.previous}
          </span>
        )}

        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {numbers.map((n, index) =>
            n === null ? (
              <span key={`gap-${index}`} aria-hidden className="px-1 text-sm font-bold text-ink-400">
                …
              </span>
            ) : n === page ? (
              <span
                key={n}
                aria-current="page"
                className="min-w-[2.5rem] rounded-xl px-3 py-2 text-center text-sm font-black tabular-nums text-brand-700 shadow-neu-inset-sm"
              >
                {n}
              </span>
            ) : (
              <a
                key={n}
                href={href(n)}
                aria-label={t.pagination.goTo(n)}
                className="min-w-[2.5rem] rounded-xl bg-surface px-3 py-2 text-center text-sm font-bold tabular-nums text-ink-600 shadow-neu-sm transition-all duration-150 ease-neu hover:text-ink-900"
              >
                {n}
              </a>
            ),
          )}
        </div>

        {page < pageCount ? (
          <a href={href(page + 1)} rel="next" className="btn-ghost !py-2">
            {t.dashboard.next}
          </a>
        ) : (
          <span aria-hidden className="btn-ghost !py-2 pointer-events-none opacity-40">
            {t.dashboard.next}
          </span>
        )}
      </div>

      <p className="text-center text-xs text-ink-500">
        {t.pagination.summary(page, pageCount, total)}
        {/* Said out loud rather than hidden: the alternative is a page counter
            that quietly disagrees with the result count. */}
        {truncated && <span className="ml-1 text-ink-400">· {t.pagination.truncated}</span>}
      </p>
    </nav>
  );
}
