import { randomBytes } from 'node:crypto';
import { prisma } from './prisma';
import { buildCalendar, type IcsEvent } from './ics';

/**
 * The subscribable calendar feed.
 *
 * Apple Calendar and Google Calendar fetch a subscription URL from their own
 * servers, with no cookies and no way to complete a login — so the URL itself
 * has to carry the credential. That is a real trade-off and worth being explicit
 * about: anyone holding the link can read this user's viewing schedule (dates,
 * addresses, notes) until it is rotated. It grants nothing else: no session, no
 * write access, and no visibility of anything but visits.
 *
 * The token is 32 bytes of CSPRNG output, generated on first use so a user who
 * never opens the agenda never has one.
 */

export function newCalendarToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Returns the user's feed token, creating it on first request. */
export async function ensureCalendarToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { calendarToken: true } });
  if (user?.calendarToken) return user.calendarToken;

  const token = newCalendarToken();
  await prisma.user.update({ where: { id: userId }, data: { calendarToken: token } });
  return token;
}

/** Invalidates every existing subscription and issues a new URL. */
export async function rotateCalendarToken(userId: string): Promise<string> {
  const token = newCalendarToken();
  await prisma.user.update({ where: { id: userId }, data: { calendarToken: token } });
  return token;
}

/**
 * Every visit the user can see, across ALL their workspaces.
 *
 * A calendar is a person, not a workspace: nobody wants to subscribe to one feed
 * per party and merge them by hand. So this deliberately ignores the active
 * workspace and returns the union of their solo agenda and every party they
 * belong to.
 */
export async function visitsForUser(userId: string) {
  const memberships = await prisma.partyMember.findMany({ where: { userId }, select: { partyId: true } });
  const partyIds = memberships.map((m) => m.partyId);

  return prisma.visit.findMany({
    where: {
      OR: [
        // Solo Mode shares one scopeKey across all users, so the user id is what
        // separates personal agendas.
        { scopeKey: 'solo', userId },
        ...(partyIds.length ? [{ partyId: { in: partyIds } }] : []),
      ],
    },
    orderBy: { scheduledAt: 'asc' },
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
}

type FeedVisit = Awaited<ReturnType<typeof visitsForUser>>[number];

const money = (value: number) => `R$ ${value.toLocaleString('pt-BR')}`;

export function visitToEvent(visit: FeedVisit, appUrl: string | null): IcsEvent {
  const p = visit.property;
  const where = [p.address, p.neighborhood, p.city, p.state].filter(Boolean).join(', ');

  const description = [
    `${money(p.totalPrice)}/mês`,
    visit.party ? `Party: ${visit.party.name}` : null,
    `Agendado por ${visit.user.name}`,
    visit.notes,
    p.sourceUrl,
    appUrl,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    // Stable per visit, so editing the time updates the event in the subscriber's
    // calendar instead of adding a second one.
    uid: `visit-${visit.id}@findhome`,
    start: visit.scheduledAt,
    durationMinutes: visit.durationMin,
    summary: `Visita: ${p.title.slice(0, 80)}`,
    description,
    location: where,
    url: p.sourceUrl,
    // updatedAt as SEQUENCE: monotonic per edit, which is all clients require.
    sequence: Math.floor(visit.updatedAt.getTime() / 1000),
    alarmMinutesBefore: 60,
  };
}

export function buildUserFeed(visits: FeedVisit[], name: string, appOrigin: string | null): string {
  return buildCalendar(
    visits.map((visit) => visitToEvent(visit, appOrigin ? `${appOrigin}/property/${visit.propertyId}` : null)),
    { name, refreshMinutes: 60 },
  );
}
