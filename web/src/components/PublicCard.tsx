import Link from 'next/link';
import ListingImage from './ListingImage';
import { money, sourceLabel } from '@/lib/format';
import { displayImage } from '@/lib/media';
import type { Dict } from '@/lib/i18n';
import type { PublicListing } from '@/lib/public-feed';

/**
 * A listing as a stranger sees it.
 *
 * A separate component from PropertyCard on purpose, and the reason is not
 * styling. PropertyCard takes a `UiProperty` — interactions, pins, notes, party
 * scores — and renders rating buttons that write to the database. Reusing it here
 * would mean either passing a fake empty workspace (one refactor away from
 * leaking somebody's notes) or threading an `anonymous` flag through every branch
 * of a 300-line component.
 *
 * This one takes only `PublicListing`, whose type cannot express private data at
 * all. Nothing scoped can reach it, because there is nowhere to put it.
 */
export default function PublicCard({
  listing,
  t,
  blurred = false,
}: {
  listing: PublicListing;
  t: Dict;
  /** Rendered under the gate: visible, unreadable, and not clickable. */
  blurred?: boolean;
}) {
  const forSale = listing.listingType === 'SALE';
  const monthlyCosts = listing.condoFee + listing.taxFee;
  const image = displayImage(listing);

  const body = (
    <>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-sunken shadow-neu-inset-sm">
        <ListingImage
          src={image}
          alt={blurred ? '' : listing.title}
          fallback={t.card.noPhoto}
          className="h-full w-full object-cover"
        />
        <span className="absolute left-2.5 top-2.5 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-700 shadow-neu-sm backdrop-blur">
          {sourceLabel(listing.source)}
        </span>
        {listing.images.length > 1 && (
          <span className="absolute bottom-2.5 right-2.5 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-bold text-ink-700 shadow-neu-sm backdrop-blur">
            {t.card.photos(listing.images.length)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4 pt-3">
        <p className="line-clamp-2 text-sm font-bold leading-snug text-ink-800">{listing.title}</p>
        <p className="text-xs font-medium text-ink-500">
          {listing.neighborhood} · {listing.city}
        </p>

        <div className="mt-auto pt-1">
          <span className="text-xl font-black tracking-tight text-ink-900">{money(listing.totalPrice)}</span>
          <span className="ml-1 text-xs font-medium text-ink-500">
            {forSale ? t.card.askingPrice : t.card.perMonth}
          </span>
          <p className="mt-0.5 text-[11px] text-ink-400">
            {forSale
              ? monthlyCosts > 0
                ? t.card.saleMonthly(money(monthlyCosts))
                : t.card.saleNoMonthly
              : t.card.breakdown(money(listing.rentPrice), money(monthlyCosts))}
          </p>
        </div>

        <ul className="well-sm flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px] font-semibold text-ink-600">
          <li>
            {listing.bedrooms} {t.card.bed}
          </li>
          <li aria-hidden className="text-ink-300">
            ·
          </li>
          <li>
            {listing.bathrooms} {t.card.bath}
          </li>
          <li aria-hidden className="text-ink-300">
            ·
          </li>
          <li>{listing.sqm} m²</li>
          {listing.petFriendly && (
            <>
              <li aria-hidden className="text-ink-300">
                ·
              </li>
              <li className="text-brand-700">{t.card.petOk}</li>
            </>
          )}
        </ul>
      </div>
    </>
  );

  if (blurred) {
    return (
      <article
        // Out of the tab order and off the accessibility tree entirely: this is
        // decoration showing that more exists, and a screen-reader user tabbing
        // into three unreadable cards would just be lost.
        aria-hidden
        className="card pointer-events-none flex select-none flex-col overflow-hidden p-3 opacity-60 blur-[6px]"
      >
        {body}
      </article>
    );
  }

  return (
    <article className="card flex flex-col overflow-hidden p-3 transition-shadow duration-200 ease-neu hover:shadow-neu-lg">
      <Link href={`/imovel/${listing.id}`} className="flex flex-1 flex-col">
        {body}
      </Link>
    </article>
  );
}
