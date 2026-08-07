'use client';

import { useSearchParams } from 'next/navigation';
import { useT } from './LocaleProvider';
import type { PublicFacets } from '@/lib/public-feed';

/**
 * The filter bar an anonymous visitor gets.
 *
 * Deliberately five controls, not the twenty in `FeedControls`. Someone who has
 * not signed up has not told us anything and is not going to fill in a form —
 * the job here is to let them narrow enough to see that the app has what they
 * are looking for, and then get out of the way.
 *
 * A plain GET form for the same reason as the signed-in toolbar: the browser
 * performs the navigation, the URL is exactly what the form says, it is
 * shareable, and it works with JavaScript off. See the long note in
 * FeedControls.tsx for the history behind that decision.
 */
export default function PublicFilters({
  facets,
  priceSteps,
}: {
  facets: PublicFacets;
  priceSteps: number[];
}) {
  /**
   * The dictionary comes from the context, NOT from a prop.
   *
   * `Dict` contains parameterised entries — `photos(n)`, `showing(a, b, c)` —
   * which are functions, and functions cannot cross the server/client boundary.
   * Passing `t` down from the page would throw "Functions cannot be passed
   * directly to Client Components" at runtime, even though this component only
   * reads plain strings out of it. Same reason FeedControls does it this way.
   */
  const t = useT();
  const params = useSearchParams();

  /** Submits the form the control belongs to. */
  const submit = (event: { currentTarget: { form: HTMLFormElement | null } }) => {
    event.currentTarget.form?.requestSubmit();
  };

  /** Blank fields are dropped, so clearing one removes its parameter. */
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const fields = Array.from(event.currentTarget.elements).filter(
      (el): el is HTMLSelectElement => el instanceof HTMLSelectElement,
    );
    const blanked = fields.filter((el) => el.value === '' && !el.disabled);
    for (const el of blanked) el.disabled = true;
    window.setTimeout(() => {
      for (const el of blanked) el.disabled = false;
    }, 0);
  }

  const select = (
    name: string,
    label: string,
    anyLabel: string,
    options: Array<{ value: string; label: string }>,
  ) => (
    <label className="min-w-0 flex-1">
      <span className="label !mb-1.5">{label}</span>
      <select name={name} className="input !py-2" defaultValue={params.get(name) ?? ''} onChange={submit}>
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form
      // Remount when the URL changes so every defaultValue re-seeds.
      key={params.toString()}
      action="/"
      method="get"
      onSubmit={onSubmit}
      className="card mb-6 flex flex-wrap items-end gap-3 p-4"
    >
      {select(
        'tipo',
        t.public.listingType,
        t.preferences.rent,
        [{ value: 'venda', label: t.preferences.buy }],
      )}

      {select(
        'city',
        t.preferences.city,
        t.public.anyCity,
        facets.cities.map((city) => ({ value: city.slug, label: `${city.name} (${city.count})` })),
      )}

      {facets.neighborhoods.length > 1 &&
        select(
          'bairro',
          t.filters.neighborhood,
          t.filters.anyNeighborhood,
          facets.neighborhoods.map((hood) => ({ value: hood.slug, label: `${hood.name} (${hood.count})` })),
        )}

      {select(
        'ate',
        t.filters.maxPrice,
        t.filters.anyPrice,
        priceSteps.map((step) => ({
          value: String(step),
          label: `≤ R$ ${step.toLocaleString('pt-BR')}`,
        })),
      )}

      {select(
        'quartos',
        t.filters.bedrooms,
        t.filters.any,
        [1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}+` })),
      )}

      <noscript>
        <button type="submit" className="btn-ghost !py-2">
          {t.filters.search}
        </button>
      </noscript>
    </form>
  );
}
