import { z } from 'zod';
import { handler, ok } from '@/lib/http';
import { ensureCalendarToken, rotateCalendarToken } from '@/lib/calendar';
import { requireUser } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/**
 * Issues (GET) or rotates (POST) the signed-in user's calendar subscription URL.
 *
 * Split from the feed itself because these two need opposite auth: this one
 * requires a session, the feed cannot have one.
 */

/** Absolute URL, so it can be pasted straight into a calendar app. */
function feedUrl(req: Request, token: string): { https: string; webcal: string } {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, '');
  // Behind a reverse proxy the Host header is the only thing that knows the
  // public name; APP_ORIGIN overrides it when that is wrong too.
  const origin = configured ?? new URL(req.url).origin;
  const path = `/api/calendar/${token}.ics`;

  return {
    https: `${origin}${path}`,
    // webcal:// makes desktop Apple Calendar / Outlook subscribe on click
    // instead of downloading a one-off snapshot.
    webcal: `${origin.replace(/^https?:/, 'webcal:')}${path}`,
  };
}

export const GET = handler(async (req: Request) => {
  const session = await requireUser();
  const token = await ensureCalendarToken(session.sub);
  return ok({ ...feedUrl(req, token) });
});

const body = z.object({ rotate: z.literal(true) });

export const POST = handler(async (req: Request) => {
  const session = await requireUser();
  body.parse(await req.json().catch(() => ({})));

  const token = await rotateCalendarToken(session.sub);
  return ok({ ...feedUrl(req, token), rotated: true });
});
