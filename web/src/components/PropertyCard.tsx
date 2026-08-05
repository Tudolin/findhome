'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { InteractionStatus } from '@prisma/client';
import { money, sourceLabel } from '@/lib/format';
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
      )}
    >
      <div className="p-3 pb-0">
        <div className="relative">
          <Link
            href={`/property/${property.id}`}
            className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-surface-sunken shadow-neu-inset-sm"
          >
            <ListingImage
              src={property.images[0]}
              alt={property.title}
              fallback={t.card.noPhoto}
              className="h-full w-full object-cover"
            />
            <span className="absolute left-2.5 top-2.5 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-700 shadow-neu-sm backdrop-blur">
              {sourceLabel(property.source)}
            </span>
            {property.images.length > 1 && (
              <span className="absolute bottom-2.5 right-2.5 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-bold text-ink-700 shadow-neu-sm backdrop-blur">
                {t.card.photos(property.images.length)}
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
          </p>
        </div>

        <div>
          <span className="text-xl font-black tracking-tight text-ink-900">{money(property.totalPrice)}</span>
          <span className="ml-1 text-xs font-medium text-ink-500">{t.card.perMonth}</span>
          <p className="mt-0.5 text-[11px] text-ink-400">
            {t.card.breakdown(money(property.rentPrice), money(property.condoFee + property.taxFee))}
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
            <a href={property.sourceUrl} target="_blank" rel="noreferrer" className="text-ink-500 hover:text-ink-700">
              {t.card.original}
            </a>
          </div>

          {error && <p className="text-[11px] font-medium text-danger">{error}</p>}
        </div>
      </div>
    </article>
  );
}
