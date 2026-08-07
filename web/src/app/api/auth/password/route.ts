import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { badRequest, handler, ok } from '@/lib/http';
import { assessPassword } from '@/lib/password';
import { revokeAllSessions } from '@/lib/session';
import { requirePassword } from '@/lib/step-up';
import { requireUser } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
  /**
   * Whether to keep this browser signed in. Defaults to true because the
   * alternative — changing your password and being immediately thrown out — reads
   * as a failure, and people stop doing it.
   */
  keepThisDevice: z.boolean().default(true),
});

export const PUT = handler(async (req: Request) => {
  const session = await requireUser();
  const { currentPassword, newPassword, keepThisDevice } = schema.parse(await req.json());

  await requirePassword(session.sub, currentPassword);

  if (currentPassword === newPassword) throw badRequest('A senha nova é igual à atual.');

  const verdict = assessPassword(newPassword, { email: session.email, name: session.name });
  if (!verdict.ok) throw badRequest(verdict.reason);

  /**
   * `passwordChangedAt` is the important half.
   *
   * `resolveSession` refuses any session created before it, which is what makes
   * changing a password a real answer to "someone has my password" rather than a
   * gesture. Revoking the rows as well is belt and braces — the timestamp alone
   * would do it, but an explicitly revoked row is what the security screen shows,
   * and the two agreeing is easier to reason about than one implying the other.
   */
  const now = new Date();
  await prisma.user.update({
    where: { id: session.sub },
    data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: now },
  });

  const revoked = await revokeAllSessions(session.sub, keepThisDevice ? session.sessionId : undefined);

  return ok({ changed: true, otherSessionsSignedOut: revoked, warnings: verdict.warnings });
});
