'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import clsx from 'clsx';
import { sourceLabel } from '@/lib/format';
import { useT } from './LocaleProvider';

const SORTS = ['newest', 'score', 'price_asc', 'price_desc', 'sqm_desc'] as const;

const STATUSES = ['ALL', 'UNREVIEWED', 'INTERESTED', 'FAVORITE', 'VISIT_SCHEDULED', 'APPLIED', 'REJECTED'] as const;

/** Price ceilings offered in the quick filter, in BRL. */
const PRICE_STEPS = [1500, 2000, 2500, 3000, 4000, 5000, 7000, 10000];
const SQM_STEPS = [30, 50, 70, 90, 120, 150];

/**
 * Feed toolbar.
 *
 * These filters narrow *on top of* the saved preferences rather than replacing
 * them — the profile is what the scraper works from and what the party agreed on,
 * so "today I only want 2-bedrooms under 3k in Batel" belongs in the URL, not in
 * a settings screen. Everything lives in the query string, which makes a
 * filtered view shareable and survives a refresh.
 *
 * The secondary row is collapsed by default: six always-visible dropdowns turn
 * the top of the feed into a form, and most sessions only ever touch search
 * and sort.
 */
export default function FeedControls({
  sources,
  neighborhoods,
}: {
  sources: string[];
  neighborhoods: Array<{ slug: string; name: string }>;
}) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(params.get('q') ?? '');

  const ignoring = params.get('ignorePreferences') === 'true';
  const pinnedOnly = params.get('pinned') === 'true';

  // Count of active secondary filters, so a collapsed row still shows there is
  // something on.
  const extraKeys = ['source', 'maxPrice', 'bedrooms', 'minSqm', 'neighborhood', 'pinned'];
  const activeExtras = extraKeys.filter((k) => params.get(k)).length;
  const [expanded, setExpanded] = useState(activeExtras > 0);

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    // Any filter change resets paging.
    if (!('page' in patch)) next.delete('page');
    startTransition(() => router.push(`/dashboard?${next.toString()}`));
  }

  const clearExtras = () => update(Object.fromEntries(extraKeys.map((k) => [k, null])));

  const select = (
    key: string,
    label: string,
    anyLabel: string,
    options: Array<{ value: string; label: string }>,
  ) => (
    <label className="min-w-0 flex-1">
      <span className="label !mb-1.5">{label}</span>
      <select className="input !py-2" value={params.get(key) ?? ''} onChange={(e) => update({ [key]: e.target.value })}>
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card mb-6 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex min-w-[16rem] flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: query });
          }}
        >
          <input
            className="input"
            placeholder={t.filters.searchPlaceholder}
            aria-label={t.filters.searchLabel}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn-ghost shrink-0">
            {t.filters.search}
          </button>
        </form>

        <select
          className="input !w-auto"
          aria-label={t.filters.statusLabel}
          value={params.get('status') ?? 'ALL'}
          onChange={(e) => update({ status: e.target.value })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.filters.statuses[s]}
            </option>
          ))}
        </select>

        <select
          className="input !w-auto"
          aria-label={t.filters.sortLabel}
          value={params.get('sort') ?? 'newest'}
          onChange={(e) => update({ sort: e.target.value })}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t.filters.sorts[s]}
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-pressed={pinnedOnly}
          onClick={() => update({ pinned: pinnedOnly ? null : 'true' })}
          className={clsx(
            'rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 ease-neu',
            pinnedOnly ? 'pressed-on' : 'pressed-off',
          )}
        >
          📌 {t.filters.pinnedOnly}
        </button>

        <button
          type="button"
          aria-pressed={ignoring}
          onClick={() => update({ ignorePreferences: ignoring ? null : 'true' })}
          className={clsx(
            'rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 ease-neu',
            ignoring ? 'pressed-on' : 'pressed-off',
          )}
        >
          {t.filters.ignore}
        </button>

        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className={clsx(
            'rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 ease-neu',
            expanded || activeExtras > 0 ? 'pressed-on' : 'pressed-off',
          )}
        >
          {expanded ? t.filters.fewer : t.filters.more}
          {activeExtras > 0 && <span className="ml-1.5 font-black">{activeExtras}</span>}
        </button>
      </div>

      {expanded && (
        <div className="well mt-4 flex flex-wrap items-end gap-3 p-4">
          {select(
            'source',
            t.filters.source,
            t.filters.anySource,
            sources.map((s) => ({ value: s, label: sourceLabel(s) })),
          )}
          {select(
            'neighborhood',
            t.filters.neighborhood,
            t.filters.anyNeighborhood,
            neighborhoods.map((n) => ({ value: n.slug, label: n.name })),
          )}
          {select(
            'maxPrice',
            t.filters.maxPrice,
            t.filters.anyPrice,
            PRICE_STEPS.map((p) => ({ value: String(p), label: `≤ R$ ${p.toLocaleString('pt-BR')}` })),
          )}
          {select(
            'bedrooms',
            t.filters.bedrooms,
            t.filters.any,
            [1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}+` })),
          )}
          {select(
            'minSqm',
            t.filters.minSqm,
            t.filters.any,
            SQM_STEPS.map((n) => ({ value: String(n), label: `${n}+ m²` })),
          )}
          {activeExtras > 0 && (
            <button type="button" onClick={clearExtras} className="btn-ghost !py-2">
              {t.filters.clear}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
