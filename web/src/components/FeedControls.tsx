'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import clsx from 'clsx';

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'score', label: 'Best match' },
  { value: 'price_asc', label: 'Cheapest' },
  { value: 'price_desc', label: 'Most expensive' },
  { value: 'sqm_desc', label: 'Largest' },
];

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'UNREVIEWED', label: 'Not reviewed' },
  { value: 'INTERESTED', label: 'Interested' },
  { value: 'FAVORITE', label: 'Favorites' },
  { value: 'VISIT_SCHEDULED', label: 'Visits' },
  { value: 'APPLIED', label: 'Applied' },
  { value: 'REJECTED', label: 'Archived' },
];

export default function FeedControls() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(params.get('q') ?? '');

  const ignoring = params.get('ignorePreferences') === 'true';

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

  return (
    <div className="card mb-6 flex flex-wrap items-center gap-3 p-4">
      <form
        className="flex min-w-[16rem] flex-1 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: query });
        }}
      >
        <input
          className="input"
          placeholder="Search title, street or neighborhood…"
          aria-label="Search listings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn-ghost shrink-0">
          Search
        </button>
      </form>

      <select
        className="input !w-auto"
        aria-label="Filter by status"
        value={params.get('status') ?? 'ALL'}
        onChange={(e) => update({ status: e.target.value })}
      >
        {STATUS_FILTERS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        className="input !w-auto"
        aria-label="Sort listings"
        value={params.get('sort') ?? 'newest'}
        onChange={(e) => update({ sort: e.target.value })}
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        aria-pressed={ignoring}
        onClick={() => update({ ignorePreferences: ignoring ? null : 'true' })}
        className={clsx(
          'rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 ease-neu',
          ignoring ? 'pressed-on' : 'pressed-off',
        )}
      >
        Ignore filters
      </button>
    </div>
  );
}
