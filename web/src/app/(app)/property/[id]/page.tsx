import Link from 'next/link';
import { notFound } from 'next/navigation';
import CommentThread from '@/components/CommentThread';
import PhotoCarousel from '@/components/PhotoCarousel';
import PropertyReview from '@/components/PropertyReview';
import ScoreBadge from '@/components/ScoreBadge';
import VisitScheduler from '@/components/VisitScheduler';
import VisitTime from '@/components/VisitTime';
import { money, relativeDate, sourceLabel } from '@/lib/format';
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

  const mapsUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent(
    `${property.address}, ${property.neighborhood}, ${property.city}`,
  )}`;

  const specs: Array<[string, string | number]> = [
    ['Bedrooms', property.bedrooms],
    ['Bathrooms', property.bathrooms],
    ['Parking', property.parkingSpots],
    ['Area', `${property.sqm} m²`],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="btn-ghost">
          ← Back to discovery
        </Link>
        <div className="flex items-center gap-3">
          {ws.kind === 'PARTY' && <ScoreBadge score={property.partyScore} />}
          <a href={property.sourceUrl} target="_blank" rel="noreferrer" className="btn-ghost">
            Open on {sourceLabel(property.source)} ↗
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <PhotoCarousel images={property.images} alt={property.title} />

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
              View on map ↗
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
              Added {relativeDate(property.createdAt)} · last seen {relativeDate(property.lastSeenAt)} · source id{' '}
              <span className="font-mono">{property.externalId}</span>
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
          <div className="card p-6">
            <h2 className="mb-4 text-sm font-bold text-ink-800">Price breakdown</h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-600">Rent</dt>
                <dd className="font-semibold tabular-nums text-ink-800">{money(property.rentPrice)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-600">Condo fee</dt>
                <dd className="font-semibold tabular-nums text-ink-800">{money(property.condoFee)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-600">Taxes (IPTU etc.)</dt>
                <dd className="font-semibold tabular-nums text-ink-800">{money(property.taxFee)}</dd>
              </div>
              <div className="well mt-4 flex items-baseline justify-between px-4 py-3">
                <dt className="text-xs font-bold uppercase tracking-wider text-ink-600">Total / month</dt>
                <dd className="text-xl font-black tabular-nums text-brand-800">{money(property.totalPrice)}</dd>
              </div>
              {property.sqm > 0 && (
                <div className="flex justify-between pt-1 text-xs text-ink-500">
                  <dt>Price per m²</dt>
                  <dd className="tabular-nums">{money(Math.round(property.totalPrice / property.sqm))}/m²</dd>
                </div>
              )}
            </dl>
          </div>

          <PropertyReview propertyId={property.id} mine={mine} others={others} workspace={workspace} />
        </div>
      </div>
    </div>
  );
}
