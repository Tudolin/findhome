'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { InteractionStatus } from '@prisma/client';
import { money, sourceLabel } from '@/lib/format';
import { galleryFor } from '@/lib/media';
import { daysListed, isNotablePriceMove, priceSignal, SITTING_DAYS } from '@/lib/signals';
import { STATUS_DOT } from '@/lib/constants';
import { updateInteraction } from '@/lib/client';
import type { UiProperty, UiWorkspace } from '@/lib/types';
import ListingImage from './ListingImage';
import { useT } from './LocaleProvider';
import ScoreBadge from './ScoreBadge';
import StarRating from './StarRating';
import StatusChip from './StatusChip';

const QUICK_STATUSES: InteractionStatus[] = ['INTERESTED', 'FAVORITE', 'VISIT_SCHEDULED', 'REJECTED'];

export default function PropertyCard({ property, workspace }: { property: UiProperty; workspace: UiWorkspace }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = property.mine;
  const isParty = workspace.kind === 'PARTY';
  const others = property.interactions.filter((i) => i.userId !== workspace.userId);

  const forSale = property.listingType === 'SALE';
  /** Condo + IPTU. Monthly either way — part of the rent, extra after a purchase. */
  const monthlyCosts = property.condoFee + property.taxFee;

  /**
   * The ad is closed — almost always because the flat went, occasionally because
   * the advertiser pulled it. Either way this card is now a *record*, and the
   * treatment says so: desaturated, a ribbon, and the price relabelled as the last
   * one advertised rather than a live asking price.
   */
  const gallery = galleryFor(property);
  const archived = gallery.archived;

  const signal = priceSignal(property.priceEvents ?? []);
  const notableMove =
    signal !== null && isNotablePriceMove(signal.changeSinceFirst, property.totalPrice);
  const listedFor = daysListed(property.createdAt);
  // Only worth saying on a live ad: "advertised for 90 days" next to a closed one
  // is describing history, not an opportunity.
  const sitting = !archived && listedFor >= SITTING_DAYS;

  const pinnedByMe = mine?.pinned ?? false;
  // Inside a party every member owns their own interaction row, so a pin is
  // attributable — and "Sam pinned this" is a different signal from "I pinned
  // this". In Solo Mode there are no others, so only the first case can happen.
  const pinnedByOthers = others.filter((o) => o.pinned);
  const pinned = pinnedByMe || pinnedByOthers.length > 0;

  async function patch(body: Parameters<typeof updateInteraction>[1]) {
    setBusy(true);
    setError(null);
    try {
      await updateInteraction(property.id, body);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pinTitle = pinnedByMe
    ? t.card.unpin
    : `${t.card.pin} · ${isParty ? t.card.pinnedForParty : t.card.pinnedForYou}`;

  return (
    <article
      className={clsx(
        'card flex flex-col overflow-hidden transition-shadow duration-200 ease-neu hover:shadow-neu-lg',
        (busy || pending) && 'opacity-70',
        pinned && 'ring-1 ring-brand-400',
        // A closed ad reads as a record at a glance, before any label is read.
        archived && !pinned && 'ring-1 ring-ink-300/40',
      )}
    >
      <div className="p-3 pb-0">
        <div className="relative">
          <Link
            href={`/property/${property.id}`}
            className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-surface-sunken shadow-neu-inset-sm"
          >
            {/* galleryFor, not images[0]: the locally mirrored copy when there is
                one, and for a closed ad *only* the mirrored copy — its portal URLs
                die with the listing. That is also what makes OLX photos load at
                all, since its CDN refuses the browser's Referer. */}
            {gallery.images.length > 0 ? (
              <ListingImage
                src={gallery.images[0]}
                alt={property.title}
                fallback={t.card.noPhoto}
                className={clsx('h-full w-full object-cover', archived && 'opacity-55 saturate-[0.35]')}
              />
            ) : (
              // A dedicated placeholder rather than the generic "no photo": for an
              // archive, the absence has a reason and a count.
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center">
                <span aria-hidden className="text-2xl opacity-40">
                  {archived ? '🗄️' : '🏚️'}
                </span>
                <span className="text-[11px] font-bold text-ink-500">
                  {archived ? t.card.archivedNoPhotos : t.card.noPhoto}
                </span>
              </div>
            )}

            <span className="absolute left-2.5 top-2.5 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-700 shadow-neu-sm backdrop-blur">
              {sourceLabel(property.source)}
            </span>

            {/* The ribbon. Two labels, because the evidence differs: a 404 on the
                ad's own page is the portal saying it is gone, while merely dropping
                out of the results is weaker. Neither claims to know it was rented —
                the app cannot know that, and the wording does not pretend to. */}
            {archived && (
              <span className="absolute inset-x-2.5 bottom-2.5 rounded-lg bg-surface/95 px-2.5 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-warning shadow-neu-sm backdrop-blur">
                {property.goneAt ? t.card.adClosed : t.card.noLongerListed}
              </span>
            )}
            {/* Suppressed while the archive ribbon occupies the bottom strip. The
                count there would be misleading anyway: it is how many photos the
                listing HAD, not how many survive. */}
            {!archived && gallery.images.length > 1 && (
              <span className="absolute bottom-2.5 right-2.5 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-bold text-ink-700 shadow-neu-sm backdrop-blur">
                {t.card.photos(gallery.images.length)}
              </span>
            )}
          </Link>

          {/* Outside the Link, so tapping the pin does not open the listing. */}
          <button
            type="button"
            disabled={busy}
            aria-pressed={pinnedByMe}
            aria-label={pinTitle}
            title={pinTitle}
            onClick={() => patch({ pinned: !pinnedByMe })}
            className={clsx(
              'absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full text-sm backdrop-blur transition-all duration-150 ease-neu disabled:opacity-50',
              pinnedByMe
                ? 'bg-brand-400 text-brand-950 shadow-neu-brand'
                : 'bg-surface/90 text-ink-500 shadow-neu-sm hover:text-ink-800',
            )}
          >
            📌
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {pinned && (
          <p className="chip tint-pro -mb-1 self-start !px-2.5 !py-0.5 !text-[10px]">
            📌 {pinnedByMe ? t.card.pinned : t.card.pinnedBy(pinnedByOthers.map((o) => o.user.name).join(', '))}
          </p>
        )}

        <div>
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <Link
              href={`/property/${property.id}`}
              className="line-clamp-2 text-sm font-bold leading-snug text-ink-800 hover:text-brand-700"
            >
              {property.title}
            </Link>
            {isParty && <ScoreBadge score={property.partyScore} compact />}
          </div>
          <p className="text-xs font-medium text-ink-500">
            {property.neighborhood} · {property.city}
            {typeof property.commuteMin === 'number' && (
              <>
                {' · '}
                <span className="font-semibold text-ink-600">🚗 {t.card.commute(property.commuteMin)}</span>
              </>
            )}
          </p>

          {/* The two signals no portal shows, and the ones you take into a
              negotiation: has the advertiser already moved, and how long have
              they been waiting. Only rendered when they actually say something —
              a badge on every card is a badge nobody reads. */}
          {(notableMove || sitting) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {notableMove && signal && (
                <span
                  className={clsx(
                    'chip !px-2 !py-0.5 !text-[10px]',
                    signal.direction === 'down' ? 'tint-pro' : 'tint-con',
                  )}
                  title={t.card.priceMovesTitle(signal.moves)}
                >
                  {signal.direction === 'down' ? '↓' : '↑'} {money(Math.abs(signal.changeSinceFirst))}
                </span>
              )}
              {sitting && (
                <span className="chip !px-2 !py-0.5 !text-[10px] text-ink-500 shadow-neu-inset-sm">
                  ⏳ {t.card.daysListed(listedFor)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* The same two numbers mean different things per listing type, so the
            labels have to branch. A sale showing "R$ 650.000 /mês total" and
            "R$ 650.000 aluguel + R$ 900 taxas" was the visible half of the
            total_price bug — see normalize() in scraper/src/persist.ts. */}
        <div>
          <span
            className={clsx(
              'text-xl font-black tracking-tight',
              archived ? 'text-ink-600' : 'text-ink-900',
            )}
          >
            {money(property.totalPrice)}
          </span>
          {/* An archived price is the LAST one advertised, not a live one. Saying
              "/mês total" next to a closed ad implies you could still take it at
              that number. */}
          <span className="ml-1 text-xs font-medium text-ink-500">
            {archived ? t.card.lastAdvertised : forSale ? t.card.askingPrice : t.card.perMonth}
          </span>
          <p className="mt-0.5 text-[11px] text-ink-400">
            {forSale
              ? monthlyCosts > 0
                ? t.card.saleMonthly(money(monthlyCosts))
                : t.card.saleNoMonthly
              : t.card.breakdown(money(property.rentPrice), money(monthlyCosts))}
          </p>
        </div>

        <ul className="well-sm flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px] font-semibold text-ink-600">
          <li>
            {property.bedrooms} {t.card.bed}
          </li>
          <li aria-hidden className="text-ink-300">
            ·
          </li>
          <li>
            {property.bathrooms} {t.card.bath}
          </li>
          <li aria-hidden className="text-ink-300">
            ·
          </li>
          <li>
            {property.parkingSpots} {t.card.parking}
          </li>
          <li aria-hidden className="text-ink-300">
            ·
          </li>
          <li>{property.sqm} m²</li>
          {property.petFriendly && (
            <>
              <li aria-hidden className="text-ink-300">
                ·
              </li>
              <li className="text-brand-700">{t.card.petOk}</li>
            </>
          )}
        </ul>

        {/* Side-by-side pros & cons — party consensus first. */}
        {(property.partyScore.allPros.length > 0 || property.partyScore.allCons.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {property.partyScore.allPros.slice(0, 3).map((p) => (
              <span key={p.label} className="chip tint-pro !px-2.5 !py-0.5 !text-[10px]">
                {p.label}
                {p.count > 1 && <span className="opacity-60">×{p.count}</span>}
              </span>
            ))}
            {property.partyScore.allCons.slice(0, 2).map((c) => (
              <span key={c.label} className="chip tint-con !px-2.5 !py-0.5 !text-[10px]">
                {c.label}
                {c.count > 1 && <span className="opacity-60">×{c.count}</span>}
              </span>
            ))}
          </div>
        )}

        {isParty && others.length > 0 && (
          <div className="well-sm space-y-1.5 px-3 py-2.5">
            {others.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold text-ink-600">
                  {o.pinned && '📌 '}
                  {o.user.name}
                </span>
                <span className="flex items-center gap-2">
                  <StarRating value={o.rating} readOnly size="sm" />
                  <StatusChip status={o.status} size="sm" className="!shadow-none !px-1.5" />
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto space-y-3 pt-1">
          <div className="flex items-center justify-between gap-2">
            <StarRating value={mine?.rating ?? null} onChange={(rating) => patch({ rating })} />
            {mine && <StatusChip status={mine.status} size="sm" />}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {QUICK_STATUSES.map((s) => {
              const selected = mine?.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  aria-pressed={selected}
                  onClick={() => patch({ status: s })}
                  className={clsx(
                    'flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-bold transition-all duration-150 ease-neu disabled:opacity-50',
                    selected ? 'pressed-on' : 'pressed-off',
                  )}
                >
                  <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[s])} />
                  {t.status[s]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[11px] font-semibold">
            <Link href={`/property/${property.id}`} className="text-brand-700 hover:text-brand-800">
              {t.card.details}
              {property.commentCount > 0 && ` · ${property.commentCount} 💬`}
            </Link>
            {/* The original ad 404s once it is closed. Still linked — sometimes a
                portal keeps a "this listing has ended" page worth seeing — but
                labelled so the dead end is expected rather than a surprise. */}
            <a
              href={property.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className={clsx('hover:text-ink-700', archived ? 'text-ink-400' : 'text-ink-500')}
              title={archived ? t.card.originalGoneHint : undefined}
            >
              {archived ? t.card.originalGone : t.card.original}
            </a>
          </div>

          {error && <p className="text-[11px] font-medium text-danger">{error}</p>}
        </div>
      </div>
    </article>
  );
}
