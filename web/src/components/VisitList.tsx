'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { googleCalendarUrl } from '@/lib/ics';
import { useT } from './LocaleProvider';

export type UiVisit = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  notes: string | null;
  user: { id: string; name: string };
  property: { id: string; title: string; address: string; neighborhood: string; city: string; sourceUrl: string };
};

/**
 * The agenda.
 *
 * Dates are formatted in the browser rather than on the server: the server stores
 * UTC and has no reliable idea which zone the reader is in, and a viewing shown an
 * hour off is worse than useless. `undefined` as the locale argument means "use
 * whatever this device is set to".
 */
export default function VisitList({ visits, isParty }: { visits: UiVisit[]; isParty: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const now = Date.now();
  const upcoming = visits.filter((v) => new Date(v.scheduledAt).getTime() >= now - 60_000);
  const past = visits.filter((v) => new Date(v.scheduledAt).getTime() < now - 60_000).reverse();

  async function cancel(id: string) {
    if (!window.confirm(t.visits.confirmCancel)) return;
    setBusy(id);
    try {
      await fetch(`/api/visits/${id}`, { method: 'DELETE' });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  const row = (visit: UiVisit, isPast: boolean) => {
    const start = new Date(visit.scheduledAt);
    const address = [visit.property.address, visit.property.neighborhood, visit.property.city]
      .filter(Boolean)
      .join(', ');

    const gcal = googleCalendarUrl({
      uid: visit.id,
      start,
      durationMinutes: visit.durationMin,
      summary: `Visita: ${visit.property.title.slice(0, 80)}`,
      description: visit.notes ?? visit.property.sourceUrl,
      location: address,
    });

    return (
      <li key={visit.id} className={clsx('card p-4', isPast && 'opacity-60', busy === visit.id && 'opacity-40')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
              {when(visit.scheduledAt)} · {t.visits.minutes(visit.durationMin)}
            </p>
            <Link
              href={`/property/${visit.property.id}`}
              className="mt-1 block truncate text-sm font-bold text-ink-800 hover:text-brand-700"
            >
              {visit.property.title}
            </Link>
            <p className="mt-0.5 text-xs text-ink-500">{address}</p>
            {isParty && <p className="mt-1 text-[11px] text-ink-400">{t.visits.bookedBy(visit.user.name)}</p>}
            {visit.notes && <p className="well-sm mt-2 px-3 py-2 text-xs text-ink-600">{visit.notes}</p>}
          </div>

          <div className="flex shrink-0 flex-col gap-1.5 text-[11px] font-semibold">
            <a href={gcal} target="_blank" rel="noreferrer" className="text-brand-700 hover:text-brand-800">
              {t.visits.addToGoogle} ↗
            </a>
            <a href={`/api/visits/${visit.id}/ics`} className="text-ink-500 hover:text-ink-700">
              {t.visits.downloadIcs}
            </a>
            <button
              type="button"
              onClick={() => cancel(visit.id)}
              disabled={busy === visit.id}
              className="text-left text-danger hover:opacity-80"
            >
              {t.visits.cancel}
            </button>
          </div>
        </div>
      </li>
    );
  };

  if (visits.length === 0) {
    return <div className="card p-12 text-center text-sm text-ink-500">{t.visits.none}</div>;
  }

  return (
    <div className="space-y-6">
      {upcoming.length > 0 && (
        <section>
          <h2 className="label">{t.visits.upcoming}</h2>
          <ul className="space-y-3">{upcoming.map((v) => row(v, false))}</ul>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h2 className="label">{t.visits.past}</h2>
          <ul className="space-y-3">{past.map((v) => row(v, true))}</ul>
        </section>
      )}
    </div>
  );
}
