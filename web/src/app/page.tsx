import Link from 'next/link';
import { redirect } from 'next/navigation';
import PublicCard from '@/components/PublicCard';
import PublicFilters from '@/components/PublicFilters';
import { getSession } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n/server';
import { getPublicFacets, getPublicFeed, parsePublicFilters } from '@/lib/public-feed';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'FindHome — todos os portais num feed só',
  description:
    'ZAP, Viva Real, QuintoAndar, OLX, ImovelWeb e Chaves na Mão num feed só. Avalie a dois, com nota, prós e contras.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Rent and purchase need different orders of magnitude. */
const PRICE_STEPS = {
  RENT: [1500, 2000, 2500, 3000, 4000, 5000, 7000, 10000],
  SALE: [250_000, 350_000, 500_000, 650_000, 800_000, 1_000_000, 1_500_000, 2_000_000],
};

/**
 * The public front door.
 *
 * Anyone can browse the newest listings and narrow them with a handful of
 * filters. What needs an account is everything the app is actually *for*: saving,
 * rating, comparing, sharing with the person you are moving in with, alerts.
 *
 * ## The gate is a product decision, not a security control
 *
 * Everything on this page is already public on the portals it came from, and the
 * blurred teasers below the fold are real listings rendered in the HTML. Anyone
 * determined can read them. That is fine and deliberate — the limit exists
 * because "save this one" needs somewhere to save to, not because the data is
 * secret. Pretending otherwise would mean building a paywall that costs more than
 * it protects.
 *
 * What IS protected is everyone else's data: this page never touches
 * `getFeed`, never constructs a Workspace, and its query
 * (`web/src/lib/public-feed.ts`) selects only columns that were public to begin
 * with. There is no code path from here to a note, a rating or a party.
 */
export default async function PublicHome({ searchParams }: { searchParams: SearchParams }) {
  // Signed in already? This page has nothing for them.
  const session = await getSession();
  if (session) redirect('/dashboard');

  const sp = await searchParams;
  const t = await getDictionary();
  const filters = parsePublicFilters(sp);

  const facets = await getPublicFacets(filters.citySlug);
  // Fall back to the busiest city so a first visit shows something rather than an
  // empty grid and a filter bar.
  const citySlug = filters.citySlug || facets.defaultCitySlug;
  const feed = await getPublicFeed({ ...filters, citySlug });

  const forSale = filters.listingType === 'SALE';
  const registrationOpen = process.env.ALLOW_REGISTRATION !== 'false';
  const cityName = facets.cities.find((city) => city.slug === citySlug)?.name ?? '';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-400 text-sm font-black text-brand-950 shadow-neu-brand">
              FH
            </span>
            <span className="text-base font-bold tracking-tight text-ink-800">FindHome</span>
          </span>

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

      <main className="mx-auto max-w-7xl px-4 py-8">
        <section className="mb-8 max-w-3xl">
          <h1 className="text-3xl font-black leading-tight tracking-tight text-ink-900 sm:text-4xl">
            {t.public.headline}
          </h1>
          <p className="mt-3 text-base text-ink-500">{t.public.subhead}</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {['Zap Imóveis', 'Viva Real', 'QuintoAndar', 'OLX', 'ImovelWeb', 'Chaves na Mão'].map((portal) => (
              <span key={portal} className="chip-raised !py-1 !text-[11px]">
                {portal}
              </span>
            ))}
          </div>
        </section>

        {/* No `t` prop: PublicFilters is a client component and the dictionary
            contains functions. It reads the same dictionary from context. */}
        <PublicFilters facets={facets} priceSteps={forSale ? PRICE_STEPS.SALE : PRICE_STEPS.RENT} />

        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-ink-700">
            {t.public.showing(feed.listings.length, feed.total, cityName)}
          </p>
          <p className="text-xs text-ink-400">{t.public.updatedTwiceDaily}</p>
        </div>

        {feed.listings.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-base font-bold text-ink-800">{t.public.emptyTitle}</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">{t.public.emptyBody}</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {feed.listings.map((listing) => (
              <PublicCard key={listing.id} listing={listing} t={t} />
            ))}
          </div>
        )}

        {/* --- The gate ---------------------------------------------------- */}
        {feed.locked > 0 && (
          <section className="relative mt-6">
            {/* Real listings, blurred. They are `aria-hidden` and unclickable —
                decoration that shows there is more, not content. */}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {feed.teasers.map((listing) => (
                <PublicCard key={listing.id} listing={listing} t={t} blurred />
              ))}
            </div>

            {/* The fade has to sit above the blurred row and below the panel, or
                the cards read as broken rather than as withheld. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 bg-gradient-to-b from-transparent via-surface/80 to-surface"
            />

            <div className="relative -mt-24 flex justify-center px-4 sm:-mt-32">
              <div className="card w-full max-w-lg p-8 text-center">
                <p className="text-2xl font-black tracking-tight text-ink-900">
                  {t.public.lockedTitle(feed.locked)}
                </p>
                <p className="mt-3 text-sm text-ink-600">{t.public.lockedBody}</p>

                <ul className="mt-5 grid gap-2 text-left text-sm text-ink-600">
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
                  <>
                    <Link href="/register" className="btn-primary mt-6 w-full !py-3">
                      {t.public.createAccountFree}
                    </Link>
                    <p className="mt-3 text-xs text-ink-400">
                      {t.public.alreadyHave}{' '}
                      <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-800">
                        {t.auth.signIn}
                      </Link>
                    </p>
                  </>
                ) : (
                  // Registration is closed on this server. Sending someone to a
                  // form that will refuse them is worse than saying so.
                  <div className="mt-6">
                    <p className="well-sm px-4 py-3 text-sm text-ink-600">{t.public.registrationClosed}</p>
                    <Link href="/login" className="btn-ghost mt-3 w-full !py-3">
                      {t.auth.signIn}
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="mt-10 border-t border-ink-200/20 bg-surface-sunken/40 py-8">
        <div className="mx-auto max-w-7xl px-4 text-xs text-ink-400">
          <p className="max-w-3xl">{t.public.disclaimer}</p>
        </div>
      </footer>
    </div>
  );
}
