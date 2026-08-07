import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import PhotoCarousel from '@/components/PhotoCarousel';
import { getSession } from '@/lib/auth';
import { money, relativeDate, sourceLabel } from '@/lib/format';
import { getDictionary } from '@/lib/i18n/server';
import { displayImages } from '@/lib/media';
import { getPublicListing } from '@/lib/public-feed';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const listing = await getPublicListing(id);
  return {
    title: listing ? `${listing.title} · FindHome` : 'FindHome',
    description: listing
      ? `${money(listing.totalPrice)} · ${listing.neighborhood}, ${listing.city} · ${listing.bedrooms} dorm · ${listing.sqm} m²`
      : undefined,
  };
}

/**
 * A listing, as a stranger sees it.
 *
 * Photos, specs, price and a link to the original ad — everything that was
 * already public on the portal. What is missing is the entire right-hand column
 * of the signed-in version: rating, pros and cons, notes, the party score, the
 * comment thread and the visit scheduler. Those need somewhere to save to, which
 * is what the account is.
 *
 * Signed-in visitors are redirected to the real page rather than shown this one —
 * landing on a read-only version of your own app is the kind of thing that reads
 * as a bug.
 */
export default async function PublicListingPage({ params }: { params: Params }) {
  const { id } = await params;

  const session = await getSession();
  if (session) redirect(`/property/${id}`);

  const [listing, t] = await Promise.all([getPublicListing(id), getDictionary()]);
  if (!listing) notFound();

  const forSale = listing.listingType === 'SALE';
  const monthlyCosts = listing.condoFee + listing.taxFee;
  const registrationOpen = process.env.ALLOW_REGISTRATION !== 'false';

  const specs: Array<[string, string | number]> = [
    [t.property.bedrooms, listing.bedrooms],
    [t.property.bathrooms, listing.bathrooms],
    [t.property.parking, listing.parkingSpots],
    [t.property.area, `${listing.sqm} m²`],
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-400 text-sm font-black text-brand-950 shadow-neu-brand">
              FH
            </span>
            <span className="text-base font-bold tracking-tight text-ink-800">FindHome</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="btn-ghost !py-2">
              {t.auth.signIn}
            </Link>
            {registrationOpen && (
              <Link href="/register" className="btn-primary !py-2">
                {t.public.createAccount}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
        <Link href="/" className="btn-ghost">
          {t.public.backToList}
        </Link>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <PhotoCarousel images={displayImages(listing)} alt={listing.title} />

            <div className="card p-6">
              <h1 className="text-xl font-black leading-tight tracking-tight text-ink-900">{listing.title}</h1>
              <p className="mt-2 text-sm text-ink-600">
                {listing.address} · {listing.neighborhood} · {listing.city}
                {listing.state ? `/${listing.state}` : ''}
              </p>

              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {specs.map(([label, value]) => (
                  <div key={label} className="well-sm px-4 py-3">
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{label}</dt>
                    <dd className="mt-0.5 text-lg font-black text-ink-800">{value}</dd>
                  </div>
                ))}
              </dl>

              {listing.amenities.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {listing.amenities.map((amenity) => (
                    <span key={amenity} className="chip-raised">
                      {amenity}
                    </span>
                  ))}
                </div>
              )}

              {listing.description && (
                <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
                  {listing.description}
                </p>
              )}

              <p className="mt-5 text-xs text-ink-400">
                {sourceLabel(listing.source)} · {relativeDate(listing.createdAt)}
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="card p-6">
              <p className="text-3xl font-black tracking-tight text-ink-900">{money(listing.totalPrice)}</p>
              <p className="mt-1 text-sm text-ink-500">
                {forSale ? t.card.askingPrice : t.card.perMonth}
              </p>
              <p className="mt-2 text-xs text-ink-400">
                {forSale
                  ? monthlyCosts > 0
                    ? t.card.saleMonthly(money(monthlyCosts))
                    : t.card.saleNoMonthly
                  : t.card.breakdown(money(listing.rentPrice), money(monthlyCosts))}
              </p>

              <a
                href={listing.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost mt-5 w-full !py-3"
              >
                {t.property.openOn(sourceLabel(listing.source))}
              </a>
            </div>

            {/* Where the right-hand column would be. Not a blurred fake of the
                real thing — a plain statement of what the account is for. */}
            <div className="card p-6">
              <h2 className="text-sm font-bold text-ink-800">{t.public.gatedTitle}</h2>
              <ul className="mt-4 grid gap-2 text-sm text-ink-600">
                {[
                  t.public.benefitSave,
                  t.public.benefitCompare,
                  t.public.benefitTogether,
                  t.public.benefitAlerts,
                ].map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2">
                    <span aria-hidden className="mt-0.5 font-black text-brand-500">
                      ✓
                    </span>
                    {benefit}
                  </li>
                ))}
              </ul>

              {registrationOpen ? (
                <Link href="/register" className="btn-primary mt-5 w-full !py-3">
                  {t.public.createAccountFree}
                </Link>
              ) : (
                <p className="well-sm mt-5 px-4 py-3 text-sm text-ink-600">{t.public.registrationClosed}</p>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-ink-400">{t.public.disclaimer}</p>
      </main>
    </div>
  );
}
