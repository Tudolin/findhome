import { z } from 'zod';
import { handler, ok } from '@/lib/http';
import { listSessions, pruneSessions, revokeAllSessions, revokeSession } from '@/lib/session';
import { pruneAttempts, recentAttempts } from '@/lib/login-guard';
import { requirePassword } from '@/lib/step-up';
import { requireUser } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/**
 * The devices signed in to this account, and how to sign them out.
 *
 *   GET                                 -> sessions + recent activity
 *   DELETE { password, sessionId }      -> one device
 *   DELETE { password, all: true }      -> everything except this one
 */

export const GET = handler(async () => {
  const session = await requireUser();

  // Opportunistic housekeeping. Both tables grow by a handful of rows a week for
  // a household, so a cron job would be more machinery than the problem — and
  // this screen is the only place anyone looks at them.
  await Promise.all([pruneSessions(), pruneAttempts()]);

  const [sessions, attempts] = await Promise.all([
    listSessions(session.sub),
    recentAttempts(session.email),
  ]);

  return ok({
    // Marked rather than filtered: "this device" has to be visible in the list,
    // or the count does not add up and signing out the wrong one is easy.
    sessions: sessions.map((row) => ({ ...row, current: row.id === session.sessionId })),
    attempts,
  });
});

const schema = z
  .object({
    password: z.string().min(1).max(200),
    sessionId: z.string().min(1).optional(),
    all: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.sessionId) !== Boolean(value.all), {
    message: 'Informe sessionId ou all, não os dois',
  });

export const DELETE = handler(async (req: Request) => {
  const session = await requireUser();
  const { password, sessionId, all } = schema.parse(await req.json());

  // Signing every other device out is the first thing anyone does after a scare,
  // and it is exactly what a passer-by at an unlocked laptop would do to lock the
  // owner out. The password is what tells the two apart.
  await requirePassword(session.sub, password);

  if (all) {
    const revoked = await revokeAllSessions(session.sub, session.sessionId);
    return ok({ revoked });
  }

  const done = await revokeSession(sessionId!, session.sub);
  return ok({ revoked: done ? 1 : 0 });
});
