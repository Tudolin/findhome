import Link from 'next/link';
import { notFound } from 'next/navigation';
import CommentThread from '@/components/CommentThread';
import PhotoCarousel from '@/components/PhotoCarousel';
import PropertyReview from '@/components/PropertyReview';
import ScoreBadge from '@/components/ScoreBadge';
import VisitScheduler from '@/components/VisitScheduler';
import VisitTime from '@/components/VisitTime';
import { money, relativeDate, sourceLabel } from '@/lib/format';
import { galleryFor } from '@/lib/media';
import { entryCost } from '@/lib/costs';
import { getDictionary } from '@/lib/i18n/server';
import { prisma } from '@/lib/prisma';
import { getPropertyDetail } from '@/lib/queries';
import { resolveWorkspace, scopeFilter } from '@/lib/workspace';
import type { UiInteraction, UiWorkspace } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const ws = await resolveWorkspace().catch(() => null);
  if (!ws) return { title: 'Property · FindHome' };
  const property = await getPropertyDetail(ws, id);
  return { title: property ? `${property.title} · FindHome` : 'Property · FindHome' };
}

export default async function PropertyPage({ params }: { params: Params }) {
  const { id } = await params;
  const [ws, t] = await Promise.all([resolveWorkspace(), getDictionary()]);
  const property = await getPropertyDetail(ws, id);
  if (!property) notFound();

  const visits = await prisma.visit.findMany({
    where: { ...scopeFilter(ws), propertyId: id },
    orderBy: { scheduledAt: 'asc' },
    include: { user: { select: { name: true } } },
  });

  const workspace: UiWorkspace = {
    kind: ws.kind,
    id: ws.partyId ?? 'solo',
    name: ws.name,
    members: ws.members,
    userId: ws.userId,
  };

  const mine = (property.mine ?? null) as UiInteraction | null;
  const others = property.interactions.filter((i) => i.userId !== ws.userId) as unknown as UiInteraction[];

  const forSale = property.listingType === 'SALE';
  const gallery = galleryFor(property);
  const cost = entryCost(property.totalPrice);

  const mapsUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent(
    `${property.address}, ${property.neighborhood}, ${property.city}`,
  )}`;

  const specs: Array<[string, string | number]> = [
    [t.property.bedrooms, property.bedrooms],
    [t.property.bathrooms, property.bathrooms],
    [t.property.parking, property.parkingSpots],
    [t.property.area, `${property.sqm} m²`],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="btn-ghost">
          {t.property.back}
        </Link>
        <div className="flex items-center gap-3">
          {ws.kind === 'PARTY' && <ScoreBadge score={property.partyScore} />}
          <a href={property.sourceUrl} target="_blank" rel="noreferrer" className="btn-ghost">
            {t.property.openOn(sourceLabel(property.source))}
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* Mirrored copies where they exist, and for a closed ad *only* those —
              see galleryFor in lib/media. Resolved here, in a server component, so
              the carousel stays a dumb list renderer. */}
          <PhotoCarousel
            images={gallery.images}
            alt={property.title}
            archived={gallery.archived}
            missing={gallery.missing}
          />

          {gallery.archived && (
            <div className="card border border-warning/40 p-5">
              <p className="text-sm font-bold text-warning">
                {property.goneAt ? t.property.adClosed : t.property.noLongerListed}
              </p>
              {property.goneAt && (
                <p className="mt-1 text-xs text-ink-500">
                  {t.property.adClosedOn(relativeDate(property.goneAt))}
                </p>
              )}
              {/* The honest framing. The app knows the ad closed; it does not know
                  the flat was taken, and saying so would be inventing a fact. */}
              <p className="mt-3 text-sm text-ink-600">{t.property.archivedMeaning}</p>
              <p className="mt-2 text-xs text-ink-500">
                {gallery.images.length > 0 ? t.property.archivedKept(gallery.images.length) : t.property.archivedNoKept}
              </p>
            </div>
          )}

          <div className="card p-6">
            <h1 className="text-xl font-black leading-tight tracking-tight text-ink-900">{property.title}</h1>
            <p className="mt-2 text-sm text-ink-600">
              {property.address} · {property.neighborhood} · {property.city}
              {property.state ? `/${property.state}` : ''}
            </p>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs font-semibold text-brand-700 hover:text-brand-800"
            >
              {t.property.viewOnMap}
            </a>

            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {specs.map(([label, value]) => (
                <div key={label} className="well-sm px-4 py-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{label}</dt>
                  <dd className="mt-0.5 text-lg font-black text-ink-800">{value}</dd>
                </div>
              ))}
            </dl>

            {property.amenities.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {property.amenities.map((a) => (
                  <span key={a} className="chip-raised">
                    {a}
                  </span>
                ))}
              </div>
            )}

            {property.description && (
              <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{property.description}</p>
            )}

            <p className="mt-5 text-xs text-ink-400">
              {t.property.added(
                relativeDate(property.createdAt),
                relativeDate(property.lastSeenAt),
                property.externalId,
              )}
            </p>
          </div>

          <div className="card p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-ink-800">📅 {t.visits.title}</h2>
              <Link href="/visits" className="text-xs font-semibold text-brand-700 hover:text-brand-800">
                {t.visits.subscribe} →
              </Link>
            </div>

            {visits.length > 0 && (
              <ul className="mb-4 space-y-2">
                {visits.map((visit) => (
                  <li key={visit.id} className="well-sm flex flex-wrap justify-between gap-2 px-3 py-2 text-xs">
                    <span className="font-bold text-brand-700">
                      <VisitTime iso={visit.scheduledAt.toISOString()} /> · {t.visits.minutes(visit.durationMin)}
                    </span>
                    {ws.kind === 'PARTY' && (
                      <span className="text-ink-500">{t.visits.bookedBy(visit.user.name)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <VisitScheduler propertyId={property.id} />
          </div>

          <div className="card p-6">
            <CommentThread
              propertyId={property.id}
              comments={property.comments}
              currentUserId={ws.userId}
              isParty={ws.kind === 'PARTY'}
            />
          </div>
        </div>

        <div className="space-y-6">
          {/* Rent and purchase are read differently, so the breakdown is laid out
              differently. For rent the three lines add up to the total. For a
              purchase the asking price stands alone and the fees are what you go
              on paying every month after buying — presenting them as a sum was
              how a R$ 650.000 flat ended up labelled R$ 651.200 "per month". */}
          <div className="card p-6">
            <h2 className="mb-4 text-sm font-bold text-ink-800">
              {forSale ? t.property.saleBreakdown : t.property.priceBreakdown}
            </h2>
            <dl className="space-y-2.5 text-sm">
              {forSale ? (
                <>
                  <div className="well mb-4 flex items-baseline justify-between px-4 py-3">
                    <dt className="text-xs font-bold uppercase tracking-wider text-ink-600">
                      {t.property.askingPrice}
                    </dt>
                    <dd className="text-xl font-black tabular-nums text-brand-800">{money(property.totalPrice)}</dd>
                  </div>
                  {/* Wrapped in a div: a <dl> may only contain dt/dd/div. */}
                  <div className="!mt-4 text-xs font-bold uppercase tracking-wider text-ink-500">
                    {t.property.afterBuying}
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <dt className="text-ink-600">{t.property.rent}</dt>
                  <dd className="font-semibold tabular-nums text-ink-800">{money(property.rentPrice)}</dd>
                </div>
              )}

              <div className="flex justify-between">
                <dt className="text-ink-600">{t.property.condoFee}</dt>
                <dd className="font-semibold tabular-nums text-ink-800">{money(property.condoFee)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-600">{t.property.taxes}</dt>
                <dd className="font-semibold tabular-nums text-ink-800">{money(property.taxFee)}</dd>
              </div>

              <div className="well mt-4 flex items-baseline justify-between px-4 py-3">
                <dt className="text-xs font-bold uppercase tracking-wider text-ink-600">
                  {forSale ? t.property.monthlyAfter : t.property.total}
                </dt>
                <dd
                  className={
                    forSale
                      ? 'text-base font-black tabular-nums text-ink-800'
                      : 'text-xl font-black tabular-nums text-brand-800'
                  }
                >
                  {money(forSale ? property.condoFee + property.taxFee : property.totalPrice)}
                </dd>
              </div>

              {property.sqm > 0 && (
                <div className="flex justify-between pt-1 text-xs text-ink-500">
                  <dt>{t.property.pricePerSqm}</dt>
                  <dd className="tabular-nums">{money(Math.round(property.totalPrice / property.sqm))}/m²</dd>
                </div>
              )}

              {/* Chaves na Mão publishes no fees at all, so a sale there shows
                  R$ 0 / R$ 0. Saying "not published" beats implying it is free. */}
              {property.condoFee === 0 && property.taxFee === 0 && (
                <div className="pt-1 text-[11px] text-ink-400">{t.property.feesUnknown}</div>
              )}
            </dl>
          </div>

          {/* The number nobody shows you.
              On a R$ 650.000 flat the taxes and fees are around R$ 30.000, and
              they appear on no portal — so the advertised price is never what
              leaves your account. Rates are configurable and labelled as an
              estimate, because ITBI is municipal and genuinely varies. */}
          {forSale && (
            <div className="card p-6">
              <h2 className="mb-1 text-sm font-bold text-ink-800">{t.property.entryCost}</h2>
              <p className="mb-4 text-xs text-ink-500">{t.property.entryCostHint}</p>

              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-600">{t.property.itbi}</dt>
                  <dd className="font-semibold tabular-nums text-ink-800">{money(cost.itbi)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-600">{t.property.deed}</dt>
                  <dd className="font-semibold tabular-nums text-ink-800">{money(cost.deed)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-600">{t.property.registry}</dt>
                  <dd className="font-semibold tabular-nums text-ink-800">{money(cost.registry)}</dd>
                </div>
                <div className="well mt-4 flex items-baseline justify-between px-4 py-3">
                  <dt className="text-xs font-bold uppercase tracking-wider text-ink-600">
                    {t.property.entryTotal}
                  </dt>
                  <dd className="text-xl font-black tabular-nums text-brand-800">{money(cost.total)}</dd>
                </div>
                <div className="flex justify-between pt-1 text-xs text-ink-500">
                  <dt>{t.property.feesOnly}</dt>
                  <dd className="tabular-nums">
                    {money(cost.fees)} · +{Math.round(cost.feesPct * 100)}%
                  </dd>
                </div>
              </dl>

              <p className="mt-4 text-[11px] text-ink-400">{t.compare.costDisclaimer}</p>
            </div>
          )}

          <PropertyReview propertyId={property.id} mine={mine} others={others} workspace={workspace} />
        </div>
      </div>
    </div>
  );
}
