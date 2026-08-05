import { headers } from 'next/headers';
import CalendarSubscription from '@/components/CalendarSubscription';
import VisitList, { type UiVisit } from '@/components/VisitList';
import { ensureCalendarToken } from '@/lib/calendar';
import { getDictionary } from '@/lib/i18n/server';
import { prisma } from '@/lib/prisma';
import { resolveWorkspace, scopeFilter } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Visits · FindHome' };

/**
 * Absolute origin for the subscription URL.
 *
 * Built from the forwarded headers so the link works when the app sits behind a
 * reverse proxy on a different hostname than the container knows about;
 * APP_ORIGIN overrides both when even that is wrong (a tunnel, say).
 */
async function origin(): Promise<string> {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, '');
  if (configured) return configured;

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

export default async function VisitsPage() {
  const [ws, t] = await Promise.all([resolveWorkspace(), getDictionary()]);

  const [visits, token, base] = await Promise.all([
    prisma.visit.findMany({
      where: scopeFilter(ws),
      orderBy: { scheduledAt: 'asc' },
      include: {
        user: { select: { id: true, name: true } },
        property: {
          select: { id: true, title: true, address: true, neighborhood: true, city: true, sourceUrl: true },
        },
      },
    }),
    ensureCalendarToken(ws.userId),
    origin(),
  ]);

  const path = `/api/calendar/${token}.ics`;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight text-ink-900">{t.visits.title}</h1>
        <p className="mt-2 text-sm text-ink-500">{t.visits.subtitle}</p>
      </div>

      <div className="mb-6">
        <CalendarSubscription
          https={`${base}${path}`}
          webcal={`${base.replace(/^https?:/, 'webcal:')}${path}`}
        />
      </div>

      <VisitList
        // Dates cross to the client as ISO strings and are formatted in the
        // reader's timezone — see the note in VisitList.
        visits={visits.map((v) => ({ ...v, scheduledAt: v.scheduledAt.toISOString() })) as UiVisit[]}
        isParty={ws.kind === 'PARTY'}
      />
    </div>
  );
}
