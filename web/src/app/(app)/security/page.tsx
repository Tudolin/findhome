import { prisma } from '@/lib/prisma';
import SecurityPanel from '@/components/SecurityPanel';
import { getDictionary } from '@/lib/i18n/server';
import { LOCKOUT, recentAttempts, pruneAttempts } from '@/lib/login-guard';
import { listSessions, pruneSessions } from '@/lib/session';
import { requireUser } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Segurança · FindHome' };

/**
 * Everything about *this account*, as opposed to the search.
 *
 * Rendered on the server so the first paint already shows the real state — a
 * security screen that says "carregando…" while it fetches whether 2FA is on is
 * a security screen nobody trusts.
 */
export default async function SecurityPage() {
  const session = await requireUser();
  const t = await getDictionary();

  // Opportunistic housekeeping: both tables grow slowly and this is the only
  // screen that ever reads them.
  await Promise.all([pruneSessions(), pruneAttempts()]);

  const [user, sessions, attempts, recoveryLeft] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.sub },
      select: { email: true, name: true, totpEnabledAt: true, passwordChangedAt: true, createdAt: true },
    }),
    listSessions(session.sub),
    recentAttempts(session.email, 25),
    prisma.recoveryCode.count({ where: { userId: session.sub, usedAt: null } }),
  ]);

  return (
    <SecurityPanel
      email={user?.email ?? session.email}
      twoFactorEnabled={Boolean(user?.totpEnabledAt)}
      recoveryCodesLeft={recoveryLeft}
      passwordChangedAt={user?.passwordChangedAt?.toISOString() ?? null}
      lockoutThreshold={LOCKOUT.threshold}
      lockoutMinutes={LOCKOUT.minutes}
      sessions={sessions.map((row) => ({
        id: row.id,
        userAgent: row.userAgent,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        current: row.id === session.sessionId,
      }))}
      attempts={attempts.map((row) => ({
        id: row.id,
        ip: row.ip,
        userAgent: row.userAgent,
        success: row.success,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      }))}
      title={t.security.title}
    />
  );
}
