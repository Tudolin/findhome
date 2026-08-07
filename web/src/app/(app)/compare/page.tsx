import Link from 'next/link';
import ListingImage from '@/components/ListingImage';
import ScoreBadge from '@/components/ScoreBadge';
import StarRating from '@/components/StarRating';
import { money, sourceLabel } from '@/lib/format';
import { getDictionary } from '@/lib/i18n/server';
import { galleryFor } from '@/lib/media';
import { entryCost, rentalUpfront } from '@/lib/costs';
import { daysListed, priceSignal } from '@/lib/signals';
import { getComparison } from '@/lib/queries';
import { resolveWorkspace } from '@/lib/workspace';
import type { RawSearchParams } from '@/lib/feed-params';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Comparar · FindHome' };

/**
 * Two to four flats, side by side.
 *
 * This is the screen you actually want the night before deciding, and the one
 * that until now meant three browser tabs and a notepad. Every number on it
 * already existed somewhere in the app; what was missing was seeing them in the
 * same row.
 *
 * The best cell in each row is highlighted — cheapest, largest, best price per m²,
 * shortest commute, highest rating. Not a score: a single "winner" number would
 * hide the trade-off, and the trade-off is the entire reason you are comparing.
 */
export default async function ComparePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const [ws, t] = await Promise.all([resolveWorkspace(), getDictionary()]);

  const raw = sp.ids;
  const ids = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);

  const items = ids.length >= 2 ? await getComparison(ws, ids) : [];

  if (items.length < 2) {
    return (
      <div className="card p-12 text-center">
        <p className="text-base font-bold text-ink-800">{t.compare.emptyTitle}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">{t.compare.emptyBody}</p>
        <Link href="/my-homes" className="btn-primary mt-5 inline-flex">
          {t.nav.myHomes}
        </Link>
      </div>
    );
  }

  const forSale = items[0].listingType === 'SALE';

  /** Per-m² price, with "no area" sorting last rather than as zero. */
  const perSqm = (item: (typeof items)[number]) =>
    item.sqm > 0 ? Math.round(item.totalPrice / item.sqm) : null;

  /**
   * Index of the best value in a row, or -1.
   *
   * Returns -1 on a tie as well as on "nobody has a value" — highlighting three
   * identical cells tells you nothing and just adds noise.
   */
  function best(values: Array<number | null>, direction: 'low' | 'high'): number {
    const present = values.map((value, index) => ({ value, index })).filter((entry) => entry.value !== null);
    if (present.length < 2) return -1;

    const sorted = [...present].sort((a, b) =>
      direction === 'low' ? (a.value as number) - (b.value as number) : (b.value as number) - (a.value as number),
    );
    if (sorted[0].value === sorted[1].value) return -1;
    return sorted[0].index;
  }

  const prices = items.map((item) => item.totalPrice);
  const areas = items.map((item) => item.sqm || null);
  const perSqmValues = items.map(perSqm);
  const commutes = items.map((item) => item.commuteMin ?? null);
  const ratings = items.map((item) => item.mine?.rating ?? null);
  const listedFor = items.map((item) => daysListed(item.createdAt));

  const bestPrice = best(prices, 'low');
  const bestArea = best(areas, 'high');
  const bestPerSqm = best(perSqmValues, 'low');
  const bestCommute = best(commutes, 'low');
  const bestRating = best(ratings, 'high');

  const cell = (winner: boolean) =>
    `px-4 py-3 text-sm tabular-nums ${winner ? 'font-black text-brand-700' : 'text-ink-700'}`;

  /** Every row of the table, so the markup below stays a loop. */
  const rows: Array<{ label: string; values: Array<string | null>; winner: number }> = [
    {
      label: forSale ? t.property.askingPrice : t.property.total,
      values: items.map((item) => money(item.totalPrice)),
      winner: bestPrice,
    },
    { label: t.property.area, values: items.map((item) => (item.sqm ? `${item.sqm} m²` : null)), winner: bestArea },
    {
      label: t.property.pricePerSqm,
      values: perSqmValues.map((value) => (value === null ? null : `${money(value)}/m²`)),
      winner: bestPerSqm,
    },
    { label: t.property.bedrooms, values: items.map((item) => String(item.bedrooms)), winner: -1 },
    { label: t.property.bathrooms, values: items.map((item) => String(item.bathrooms)), winner: -1 },
    { label: t.property.parking, values: items.map((item) => String(item.parkingSpots)), winner: -1 },
    {
      label: t.compare.commute,
      values: commutes.map((value) => (value === null ? null : t.card.commute(value))),
      winner: bestCommute,
    },
    {
      label: t.compare.listedFor,
      values: listedFor.map((days) => t.card.daysListed(days)),
      winner: -1,
    },
    {
      label: t.compare.priceMove,
      values: items.map((item) => {
        const signal = priceSignal(item.priceEvents ?? []);
        if (!signal || signal.changeSinceFirst === 0) return t.compare.noMove;
        return `${signal.changeSinceFirst < 0 ? '↓' : '↑'} ${money(Math.abs(signal.changeSinceFirst))}`;
      }),
      winner: -1,
    },
    {
      // The number nobody shows you. For a purchase it is several per cent of the
      // asking price; for a rent it is a range, because it depends entirely on the
      // guarantee the landlord accepts.
      label: forSale ? t.compare.entryCost : t.compare.upfront,
      values: items.map((item) => {
        if (forSale) {
          const cost = entryCost(item.totalPrice);
          return `${money(cost.total)} (+${Math.round(cost.feesPct * 100)}%)`;
        }
        const range = rentalUpfront(item.rentPrice, item.condoFee);
        return `${money(range.min)} – ${money(range.max)}`;
      }),
      winner: -1,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-ink-900">{t.compare.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-500">{t.compare.subtitle}</p>
        </div>
        <Link href="/my-homes" className="btn-ghost">
          {t.nav.myHomes}
        </Link>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className="w-40 px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-ink-500">
                {t.compare.property}
              </th>
              {items.map((item) => {
                const gallery = galleryFor(item);
                return (
                  <th key={item.id} className="min-w-[180px] px-4 py-4 text-left align-top">
                    <Link href={`/property/${item.id}`} className="block">
                      <div className="mb-2 aspect-[4/3] overflow-hidden rounded-xl bg-surface-sunken shadow-neu-inset-sm">
                        <ListingImage
                          src={gallery.images[0]}
                          alt={item.title}
                          fallback={t.card.noPhoto}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <p className="line-clamp-2 text-sm font-bold leading-snug text-ink-800">{item.title}</p>
                      <p className="mt-1 text-xs font-normal text-ink-500">
                        {item.neighborhood} · {sourceLabel(item.source)}
                      </p>
                    </Link>
                    <div className="mt-2 flex items-center gap-2">
                      <StarRating value={item.mine?.rating ?? null} readOnly size="sm" />
                      {ws.kind === 'PARTY' && <ScoreBadge score={item.partyScore} compact />}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr key={row.label} className={index % 2 === 0 ? 'bg-surface-sunken/40' : undefined}>
                <th className="px-4 py-3 text-left text-xs font-bold text-ink-600">{row.label}</th>
                {row.values.map((value, column) => (
                  <td key={`${row.label}-${column}`} className={cell(row.winner === column)}>
                    {value ?? <span className="text-ink-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}

            {/* Pros and cons last: they are prose, not numbers, and reading them
                after the figures is the order the decision actually happens in. */}
            <tr>
              <th className="px-4 py-3 text-left align-top text-xs font-bold text-ink-600">
                {t.property.pros} / {t.property.cons}
              </th>
              {items.map((item) => (
                <td key={`tags-${item.id}`} className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {item.partyScore.allPros.slice(0, 4).map((entry) => (
                      <span key={entry.label} className="chip tint-pro !px-2 !py-0.5 !text-[10px]">
                        {entry.label}
                      </span>
                    ))}
                    {item.partyScore.allCons.slice(0, 4).map((entry) => (
                      <span key={entry.label} className="chip tint-con !px-2 !py-0.5 !text-[10px]">
                        {entry.label}
                      </span>
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-400">{ratings.some((r) => r !== null) ? '' : t.compare.rateHint}</p>
      {forSale && <p className="text-xs text-ink-400">{t.compare.costDisclaimer}</p>}
    </div>
  );
}
