'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { sourceLabel } from '@/lib/format';
import { locationSlug } from '@/lib/locations';
import { countActiveFilters, FEED_SORTS, FEED_STATUSES } from '@/lib/feed-params';
import type { FeedFacets } from '@/lib/queries';
import { useT } from './LocaleProvider';

/** Suggested ceilings/floors, in BRL and m². Free text is still accepted. */
const PRICE_STEPS = [1000, 1500, 2000, 2500, 3000, 4000, 5000, 7000, 10000, 15000];
const SQM_STEPS = [20, 30, 40, 50, 70, 90, 120, 150, 200];
const NEW_WITHIN = [1, 3, 7, 14, 30];

/** Above this many neighborhoods the list needs a search box to be usable. */
const NEIGHBORHOOD_SEARCH_THRESHOLD = 12;

/**
 * Feed toolbar.
 *
 * These filters narrow *on top of* the saved preferences rather than replacing
 * them — the profile is what the scraper works from and what the party agreed on,
 * so "today I only want 2-bedrooms under 3k in Batel or Água Verde" belongs in
 * the URL, not in a settings screen.
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
 * The pagination links are plain <a> for the same reason; see Pagination.tsx.
 *
 * The controls are therefore *uncontrolled* (`defaultValue`), keyed off the URL.
 * `key` on the form makes React rebuild it when the query string changes, so the
 * inputs re-seed from the new URL instead of keeping a stale defaultValue.
 *
 * ## Multi-select
 *
 * Neighborhoods, portals and amenities are checkbox groups sharing one `name`, so
 * the browser submits `?neighborhood=batel&neighborhood=agua-verde` with no
 * JavaScript involved. That is also why `page` is deliberately absent from this
 * form: changing a filter must land on page 1, and the only way to guarantee it
 * is to not carry the old page number across.
 */
export default function FeedControls({
  facets,
  basePath = '/dashboard',
  /** Filters that make no sense on this screen (e.g. status on "Your homes"). */
  hide = [],
}: {
  facets: FeedFacets;
  basePath?: string;
  hide?: Array<'status' | 'ignorePreferences' | 'pinned' | 'rating'>;
}) {
  const t = useT();
  const params = useSearchParams();

  const selected = useMemo(() => {
    const read = (key: string) =>
      new Set(
        params
          .getAll(key)
          .flatMap((v) => v.split(','))
          .map((v) => v.trim())
          .filter(Boolean),
      );
    return {
      neighborhoods: read('neighborhood'),
      sources: read('source'),
      amenities: read('amenity'),
    };
  }, [params]);

  const ignoring = params.get('ignorePreferences') === 'true';
  const pinnedOnly = params.get('pinned') === 'true';
  const photosOnly = params.get('photos') === 'true';

  const activeExtras = countActiveFilters(Object.fromEntries(collect(params)));
  const [expanded, setExpanded] = useState(activeExtras > 0);
  const [hoodQuery, setHoodQuery] = useState('');

  /** Submits the form the control belongs to. */
  const submit = (event: { currentTarget: { form: HTMLFormElement | null } }) => {
    event.currentTarget.form?.requestSubmit();
  };

  /**
   * Empty fields are dropped before the browser builds the query string.
   *
   * A disabled field is not submitted, so blanking a filter removes its
   * parameter instead of leaving `?minPrice=` behind. Re-enabled immediately so
   * the controls stay usable if the navigation is slow.
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

  /** Styled like a button, but backed by a checkbox so it round-trips. */
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

  /** One entry of a multi-select group. Submits on change, like every filter. */
  const chip = (name: string, value: string, label: string, checked: boolean, count?: number, hidden = false) => (
    <label
      key={value}
      className={clsx(
        'cursor-pointer select-none rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-150 ease-neu',
        checked ? 'pressed-on' : 'pressed-off',
        hidden && 'hidden',
      )}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        onChange={submit}
        className="sr-only"
      />
      {label}
      {count !== undefined && <span className="ml-1 font-normal opacity-60">{count}</span>}
    </label>
  );

  const select = (
    key: string,
    label: string,
    anyLabel: string,
    options: Array<{ value: string; label: string }>,
  ) => (
    <label className="min-w-0">
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

  /**
   * A free-text number with a datalist of sensible values.
   *
   * The unit goes in the label rather than as an overlay inside the field: a
   * number input renders spinner arrows on its right edge, and an absolutely
   * positioned suffix lands on top of them.
   */
  const numberField = (key: string, label: string, placeholder: string, steps: number[], unit: string) => (
    <label className="min-w-0">
      <span className="label !mb-1.5">
        {label} <span className="opacity-60">({unit})</span>
      </span>
      <input
        name={key}
        type="number"
        inputMode="numeric"
        min={0}
        step={unit === 'm²' ? 5 : 50}
        list={`${key}-steps`}
        placeholder={placeholder}
        defaultValue={params.get(key) ?? ''}
        className="input !py-2"
      />
      {/* Suggestions, not a closed list — typing 3750 stays valid. */}
      <datalist id={`${key}-steps`}>
        {steps.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </label>
  );

  const visibleHoods = facets.neighborhoods;
  const hoodNeedle = locationSlug(hoodQuery);
  const showHoodSearch = visibleHoods.length > NEIGHBORHOOD_SEARCH_THRESHOLD;

  /** Placeholder for a range field: the real bound, or a generic hint. */
  const bound = (range: { min: number; max: number } | null, edge: 'min' | 'max') =>
    range ? String(range[edge]) : edge === 'min' ? t.filters.noMin : t.filters.noMax;

  // Never offer "6+ bedrooms" for a feed whose largest flat has three: an option
  // that can only ever return nothing is worse than no option.
  const bedroomCeiling = Math.min(Math.max(facets.maxBedrooms, 1), 6);
  const bedroomOptions = Array.from({ length: bedroomCeiling }, (_, i) => i + 1);

  /**
   * Parameters this form owns but does not render.
   *
   * A GET form submits only its own fields, so anything hidden by `hide` would be
   * dropped from the URL the moment any filter changed. On "Your homes" that meant
   * picking a neighborhood silently threw you back to the "All reviewed" tab,
   * because `status` lives in the tab strip rather than in this form. These carry
   * it through untouched.
   *
   * `page` is deliberately NOT among them: a filter change must land on page 1.
   */
  const carried: string[] = [];
  if (hide.includes('status')) carried.push('status', 'rated');
  if (hide.includes('pinned')) carried.push('pinned');
  if (hide.includes('ignorePreferences')) carried.push('ignorePreferences');
  if (hide.includes('rating')) carried.push('minRating');

  return (
    <form
      // Remount when the URL changes so every defaultValue re-seeds.
      key={params.toString()}
      action={basePath}
      method="get"
      onSubmit={onSubmit}
      className="card mb-6 p-4"
    >
      {carried.flatMap((key) =>
        params.getAll(key).map((value, index) => (
          <input key={`${key}-${index}`} type="hidden" name={key} value={value} />
        )),
      )}

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

        {!hide.includes('status') && (
          <select
            name="status"
            className="input !w-auto"
            aria-label={t.filters.statusLabel}
            defaultValue={params.get('status') ?? 'ALL'}
            onChange={submit}
          >
            {FEED_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.filters.statuses[s]}
              </option>
            ))}
          </select>
        )}

        <select
          name="sort"
          className="input !w-auto"
          aria-label={t.filters.sortLabel}
          defaultValue={params.get('sort') ?? 'newest'}
          onChange={submit}
        >
          {FEED_SORTS.map((s) => (
            <option key={s} value={s}>
              {t.filters.sorts[s]}
            </option>
          ))}
        </select>

        {!hide.includes('pinned') && toggle('pinned', pinnedOnly, `📌 ${t.filters.pinnedOnly}`)}
        {!hide.includes('ignorePreferences') && toggle('ignorePreferences', ignoring, t.filters.ignore)}

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
      <div className={clsx('well mt-4 space-y-5 p-4', !expanded && 'hidden')}>
        {/* --- Neighborhoods: the filter people actually want two of at once ---
            role="group" + aria-label rather than fieldset/legend: a <legend> must
            be the first child of its <fieldset>, which rules out putting the
            search box on the same line as the label. The grouping semantics are
            identical either way. */}
        {visibleHoods.length > 0 && (
          <div role="group" aria-label={t.filters.neighborhoods}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="label !mb-0">
                {t.filters.neighborhoods}
                {selected.neighborhoods.size > 0 && (
                  <span className="ml-1.5 font-black text-brand-700">{selected.neighborhoods.size}</span>
                )}
              </span>
              {showHoodSearch && (
                <input
                  type="search"
                  value={hoodQuery}
                  onChange={(e) => setHoodQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter here means "I finished typing", not "submit the
                    // form" — the filtering is instant and local, so submitting
                    // would navigate for no reason and lose the typed text.
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                  placeholder={t.filters.findNeighborhood}
                  aria-label={t.filters.findNeighborhood}
                  // Deliberately no `name`: this never enters the query string.
                  // It only hides chips locally, and a checked-but-hidden chip
                  // still submits, which is the whole point.
                  className="input !w-40 !py-1 !text-xs"
                />
              )}
            </div>
            <div className="scrollbar-thin flex max-h-40 flex-wrap gap-1.5 overflow-y-auto pr-1">
              {visibleHoods.map((n) =>
                chip(
                  'neighborhood',
                  n.slug,
                  n.name,
                  selected.neighborhoods.has(n.slug),
                  n.count,
                  // A selected chip is never hidden, or the user could not see
                  // what is filtering their feed.
                  hoodNeedle.length > 0 && !n.slug.includes(hoodNeedle) && !selected.neighborhoods.has(n.slug),
                ),
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-400">{t.filters.multiHint}</p>
          </div>
        )}

        {/* --- Portals --- */}
        {facets.sources.length > 1 && (
          <fieldset>
            <legend className="label !mb-2">
              {t.filters.sources}
              {selected.sources.size > 0 && (
                <span className="ml-1.5 font-black text-brand-700">{selected.sources.size}</span>
              )}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {facets.sources.map((s) =>
                chip('source', s.value, sourceLabel(s.value), selected.sources.has(s.value), s.count),
              )}
            </div>
          </fieldset>
        )}

        {/* --- Numeric ranges ---
            The placeholders are the actual bounds in the data rather than a
            generic "no min". On a feed of 40 listings between R$ 1.900 and
            R$ 4.100, that is the difference between guessing a number and being
            told the range you are filtering inside. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {numberField('minPrice', t.filters.minPrice, bound(facets.priceRange, 'min'), PRICE_STEPS, 'R$')}
          {numberField('maxPrice', t.filters.maxPrice, bound(facets.priceRange, 'max'), PRICE_STEPS, 'R$')}
          {numberField('minSqm', t.filters.minSqm, bound(facets.sqmRange, 'min'), SQM_STEPS, 'm²')}
          {numberField('maxSqm', t.filters.maxSqm, bound(facets.sqmRange, 'max'), SQM_STEPS, 'm²')}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {select(
            'bedrooms',
            t.filters.minBedrooms,
            t.filters.any,
            bedroomOptions.map((n) => ({ value: String(n), label: `${n}+` })),
          )}
          {select(
            'maxBedrooms',
            t.filters.maxBedrooms,
            t.filters.any,
            bedroomOptions.map((n) => ({ value: String(n), label: `${n}` })),
          )}
          {select(
            'bathrooms',
            t.filters.minBathrooms,
            t.filters.any,
            [1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}+` })),
          )}
          {select(
            'parking',
            t.filters.minParking,
            t.filters.any,
            [1, 2, 3].map((n) => ({ value: String(n), label: `${n}+` })),
          )}
        </div>

        {/* --- Amenities --- */}
        {facets.amenities.length > 0 && (
          <fieldset>
            <legend className="label !mb-2">
              {t.filters.amenities}
              {selected.amenities.size > 0 && (
                <span className="ml-1.5 font-black text-brand-700">{selected.amenities.size}</span>
              )}
            </legend>
            <div className="scrollbar-thin flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pr-1">
              {facets.amenities.map((a) =>
                chip('amenity', a.value, a.value, selected.amenities.has(a.value), a.count),
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-400">{t.filters.amenitiesHint}</p>
          </fieldset>
        )}

        {/* --- The rest --- */}
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="min-w-0">
            <span className="label !mb-1.5">{t.filters.pets}</span>
            <select name="pets" className="input !py-2" defaultValue={params.get('pets') ?? ''} onChange={submit}>
              <option value="">{t.filters.any}</option>
              <option value="yes">{t.filters.petsYes}</option>
              <option value="no">{t.filters.petsNo}</option>
            </select>
          </label>

          {select(
            'newDays',
            t.filters.newWithin,
            t.filters.anyTime,
            NEW_WITHIN.map((d) => ({ value: String(d), label: t.filters.lastDays(d) })),
          )}

          {!hide.includes('rating') &&
            select(
              'minRating',
              t.filters.minRating,
              t.filters.any,
              [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: '★'.repeat(n) })),
            )}

          <div className="flex flex-wrap items-center gap-2">
            <label
              className={clsx(
                'cursor-pointer select-none rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-150 ease-neu',
                photosOnly ? 'pressed-on' : 'pressed-off',
              )}
            >
              <input
                type="checkbox"
                name="photos"
                value="true"
                defaultChecked={photosOnly}
                onChange={submit}
                className="sr-only"
              />
              📷 {t.filters.withPhotos}
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-ink-200/30 pt-3">
          <button type="submit" className="btn-primary !py-2">
            {t.filters.apply}
          </button>
          {activeExtras > 0 && (
            // A link, not a reset button: reset would restore the *initial* form
            // values, which are the current filters. Clearing means navigating to
            // the bare path.
            <a href={basePath} className="btn-ghost !py-2">
              {t.filters.clear}
            </a>
          )}
          <span className="text-[11px] text-ink-400">{t.filters.narrowsHint}</span>
        </div>
      </div>
    </form>
  );
}

/**
 * URLSearchParams -> the array-shaped record `countActiveFilters` expects,
 * preserving repeated keys.
 *
 * Typed as `Pick<…, 'forEach'>` rather than `URLSearchParams` because
 * `useSearchParams()` hands back Next's `ReadonlyURLSearchParams`, whose exact
 * relationship to `URLSearchParams` has changed between Next versions. `forEach`
 * is on both, and it is all this needs.
 */
function collect(params: Pick<URLSearchParams, 'forEach'>): Array<[string, string[]]> {
  const out = new Map<string, string[]>();
  params.forEach((value, key) => {
    const existing = out.get(key);
    if (existing) existing.push(value);
    else out.set(key, [value]);
  });
  return [...out.entries()];
}
