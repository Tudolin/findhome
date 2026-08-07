'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import PropertyCard from './PropertyCard';
import { useT } from './LocaleProvider';
import type { UiProperty, UiWorkspace } from '@/lib/types';

/**
 * The feed grid, with a tick box on each card and a tray that appears once two
 * are chosen.
 *
 * Selection lives in component state and nowhere else — no URL parameter, no
 * localStorage. It is a decision that lasts thirty seconds ("these three, side by
 * side"), and persisting it would mean coming back tomorrow to a stale tray you
 * have to remember to clear.
 *
 * Capped at four: past that the comparison table scrolls horizontally and stops
 * being readable, which defeats the point.
 */
const MAX = 4;

export default function CompareGrid({
  items,
  workspace,
}: {
  items: UiProperty[];
  workspace: UiWorkspace;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : current.length >= MAX
          ? current
          : [...current, id],
    );

  const full = selected.length >= MAX;

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((property) => {
          const picked = selected.includes(property.id);
          return (
            <div key={property.id} className="relative">
              {/* Outside the card's own markup, so PropertyCard stays unaware of
                  comparison entirely and keeps working everywhere else. */}
              <label
                className={clsx(
                  'absolute left-6 top-6 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-xs font-black transition-all duration-150 ease-neu',
                  picked
                    ? 'bg-brand-400 text-brand-950 shadow-neu-brand'
                    : 'bg-surface/90 text-ink-400 shadow-neu-sm backdrop-blur hover:text-ink-700',
                  !picked && full && 'cursor-not-allowed opacity-40',
                )}
                title={t.compare.select}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={picked}
                  disabled={!picked && full}
                  onChange={() => toggle(property.id)}
                />
                {picked ? selected.indexOf(property.id) + 1 : '+'}
              </label>

              <PropertyCard property={property} workspace={workspace} />
            </div>
          );
        })}
      </div>

      {/* The tray. Sticky at the bottom so it is reachable without scrolling back
          up, and only rendered once comparing is actually possible. */}
      {selected.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center justify-center gap-3 rounded-2xl bg-surface/95 p-4 shadow-neu-lg backdrop-blur">
          <span className="text-sm font-semibold text-ink-700">{t.compare.selected(selected.length)}</span>

          <Link
            href={`/compare?ids=${selected.join(',')}`}
            className={clsx('btn-primary !py-2', selected.length < 2 && 'pointer-events-none opacity-50')}
            aria-disabled={selected.length < 2}
          >
            {t.compare.title}
          </Link>

          <button type="button" className="btn-ghost !py-2" onClick={() => setSelected([])}>
            {t.compare.clear}
          </button>

          {selected.length < 2 && <span className="text-xs text-ink-400">{t.compare.pickOneMore}</span>}
        </div>
      )}
    </>
  );
}
