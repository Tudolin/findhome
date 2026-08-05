'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
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
 * a settings screen.
 *
 * ## Why this is a plain GET form and not router.push()
 *
 * It was an onChange handler calling `router.push()`, and that turned out to be
 * unreliable in a way I could not control: for some target URLs the router made
 * no request at all and left the address bar untouched, so a filter simply did
 * not apply. Same handler, same code path, correct href computed — the router
 * just declined. (Observed with `?ignorePreferences=true` and `?sort=newest`
 * while `?pinned=true` and `?source=…` worked from the identical call site.)
 *
 * A GET form removes the question. The browser performs the navigation, so the
 * URL is exactly what the form says, every time; it is shareable and
 * back-button-correct; and it works with JavaScript disabled. The cost is a
 * document navigation instead of a soft one, which this page pays anyway — it is
 * `force-dynamic`, so every filter change re-renders on the server regardless.
 *
 * The controls are therefore *uncontrolled* (`defaultValue`), keyed off the URL.
 * `key` on the form makes React rebuild it when the query string changes, so the
 * inputs re-seed from the new URL instead of keeping a stale defaultValue.
 */
export default function FeedControls({
  sources,
  neighborhoods,
}: {
  sources: string[];
  neighborhoods: Array<{ slug: string; name: string }>;
}) {
  const t = useT();
  const params = useSearchParams();

  const ignoring = params.get('ignorePreferences') === 'true';
  const pinnedOnly = params.get('pinned') === 'true';

  // Count of active secondary filters, so a collapsed row still shows there is
  // something on.
  const extraKeys = ['source', 'maxPrice', 'bedrooms', 'minSqm', 'neighborhood'];
  const activeExtras = extraKeys.filter((k) => params.get(k)).length + (pinnedOnly ? 1 : 0);
  const [expanded, setExpanded] = useState(activeExtras > 0);

  /** Submits the form the control belongs to. */
  const submit = (event: { currentTarget: { form: HTMLFormElement | null } }) => {
    event.currentTarget.form?.requestSubmit();
  };

  /**
   * Empty fields are dropped before the browser builds the query string.
   *
   * A disabled field is not submitted, so blanking a filter removes its
   * parameter instead of leaving `?source=` behind. Re-enabled immediately so the
   * controls stay usable if the navigation is slow.
   */
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const fields = Array.from(event.currentTarget.elements).filter(
      (el): el is HTMLInputElement | HTMLSelectElement =>
        el instanceof HTMLInputElement || el instanceof HTMLSelectElement,
    );
    const blanked = fields.filter((el) => el.type !== 'checkbox' && el.value === '' && !el.disabled);
    for (const el of blanked) el.disabled = true;
    window.setTimeout(() => {
      for (const el of blanked) el.disabled = false;
    }, 0);
  }

  /** Styled like the old buttons, but backed by a checkbox so it round-trips. */
  const toggle = (name: string, checked: boolean, label: string) => (
    <label
      className={clsx(
        'cursor-pointer select-none rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 ease-neu',
        checked ? 'pressed-on' : 'pressed-off',
      )}
    >
      <input type="checkbox" name={name} value="true" defaultChecked={checked} onChange={submit} className="sr-only" />
      {label}
    </label>
  );

  const select = (
    key: string,
    label: string,
    anyLabel: string,
    options: Array<{ value: string; label: string }>,
  ) => (
    <label className="min-w-0 flex-1">
      <span className="label !mb-1.5">{label}</span>
      <select name={key} className="input !py-2" defaultValue={params.get(key) ?? ''} onChange={submit}>
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
    <form
      // Remount when the URL changes so every defaultValue re-seeds.
      key={params.toString()}
      action="/dashboard"
      method="get"
      onSubmit={onSubmit}
      className="card mb-6 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[16rem] flex-1 gap-2">
          <input
            name="q"
            className="input"
            placeholder={t.filters.searchPlaceholder}
            aria-label={t.filters.searchLabel}
            defaultValue={params.get('q') ?? ''}
          />
          <button type="submit" className="btn-ghost shrink-0">
            {t.filters.search}
          </button>
        </div>

        <select
          name="status"
          className="input !w-auto"
          aria-label={t.filters.statusLabel}
          defaultValue={params.get('status') ?? 'ALL'}
          onChange={submit}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.filters.statuses[s]}
            </option>
          ))}
        </select>

        <select
          name="sort"
          className="input !w-auto"
          aria-label={t.filters.sortLabel}
          defaultValue={params.get('sort') ?? 'newest'}
          onChange={submit}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t.filters.sorts[s]}
            </option>
          ))}
        </select>

        {toggle('pinned', pinnedOnly, `📌 ${t.filters.pinnedOnly}`)}
        {toggle('ignorePreferences', ignoring, t.filters.ignore)}

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

      {/* Hidden while collapsed rather than unmounted: a filter that is set but
          out of sight must still be submitted, or collapsing the row would
          silently clear it. */}
      <div className={clsx('well mt-4 flex flex-wrap items-end gap-3 p-4', !expanded && 'hidden')}>
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
          <a href="/dashboard" className="btn-ghost !py-2">
            {t.filters.clear}
          </a>
        )}
      </div>
    </form>
  );
}
