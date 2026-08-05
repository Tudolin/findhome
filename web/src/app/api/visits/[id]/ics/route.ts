import { prisma } from '@/lib/prisma';
import { visitToEvent } from '@/lib/calendar';
import { buildCalendar } from '@/lib/ics';
import { resolveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * A single visit as a downloadable .ics.
 *
 * Complements the subscribable feed: this is the "put this one viewing in my
 * calendar right now" path, and unlike the feed it can require a session because
 * a browser is doing the fetching.
 */
export async function GET(req: Request, { params }: Ctx) {
  const ws = await resolveWorkspace().catch(() => null);
  if (!ws) return new Response(null, { status: 401 });

  const { id } = await params;

  const visit = await prisma.visit.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      party: { select: { name: true } },
      property: {
        select: {
          title: true,
          address: true,
          neighborhood: true,
          city: true,
          state: true,
          totalPrice: true,
          sourceUrl: true,
        },
      },
    },
  });

  if (!visit || visit.scopeKey !== ws.scopeKey) return new Response(null, { status: 404 });
  // Solo Mode shares one scopeKey, so the user id is the real boundary there.
  if (ws.kind === 'SOLO' && visit.userId !== ws.userId) return new Response(null, { status: 404 });

  const origin = process.env.APP_ORIGIN?.replace(/\/$/, '') ?? new URL(req.url).origin;
  const body = buildCalendar([visitToEvent(visit, `${origin}/property/${visit.propertyId}`)], {
    name: 'FindHome',
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="visita-${id}.ics"`,
    },
  });
}
