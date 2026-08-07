import { clearSessionCookie, getSession } from '@/lib/auth';
import { handler, ok } from '@/lib/http';
import { revokeSession } from '@/lib/session';

/**
 * Signing out now actually signs out.
 *
 * It used to only delete the cookie, which meant a token copied off the machine
 * — from a shared laptop, a backup, a screen — kept working for the rest of its
 * 30 days. Revoking the row is what makes the gesture true.
 *
 * The cookie is cleared whatever happens: a caller with an already-invalid
 * session still expects to end up signed out rather than seeing an error.
 */
export const POST = handler(async () => {
  const session = await getSession();
  if (session) await revokeSession(session.sessionId, session.sub).catch(() => undefined);

  await clearSessionCookie();
  return ok({ ok: true });
});
