import { prisma } from '@/lib/prisma';
import { buildUserFeed, visitsForUser } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/**
 * The iCalendar feed Apple/Google/Outlook subscribe to.
 *
 * Deliberately NOT behind the session cookie: those clients poll from their own
 * servers and cannot log in. The token in the path is the only credential, which
 * is why it is 32 random bytes and rotatable from the agenda screen.
 *
 * Not wrapped in `handler()` either — that helper answers JSON, and a calendar
 * client handed `{"error":…}` with a 200 shows the user a corrupt-calendar
 * dialog. Errors here are bare status codes with no body.
 *
 * The route is `[token]` rather than `?token=` so the URL ends in something a
 * calendar app recognises, and because some clients drop query strings when they
 * re-fetch a stored subscription.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;

  // Strip a trailing .ics: calendar clients are happier with a URL that looks
  // like a file, and some append it themselves.
  const clean = token.replace(/\.ics$/i, '');
  if (!clean || clean.length < 20) return new Response(null, { status: 404 });

  const user = await prisma.user.findUnique({
    where: { calendarToken: clean },
    select: { id: true, name: true },
  });
  if (!user) return new Response(null, { status: 404 });

  const visits = await visitsForUser(user.id);
  const origin = process.env.APP_ORIGIN?.replace(/\/$/, '') ?? null;
  const body = buildUserFeed(visits, `FindHome — ${user.name}`, origin);

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      // Some clients decide how to handle the response from the filename.
      'content-disposition': 'inline; filename="findhome.ics"',
      // A subscription is polled; a stale agenda is worse than a extra request.
      'cache-control': 'no-store, max-age=0',
    },
  });
}
