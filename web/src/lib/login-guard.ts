import { prisma } from './prisma';
import { requestFingerprint } from './session';

/**
 * Lockout and the sign-in audit trail.
 *
 * The in-memory limiter in ./rate-limit is a good first line and a bad only line:
 * its counters live in one process and reset to zero on every restart. On a
 * public host that is a window an attacker can open at will if the container ever
 * restarts on its own — and `restart: unless-stopped` means it does.
 *
 * So the durable half lives here, in the database: consecutive failures on the
 * account, a lock that outlives a deploy, and a record of every attempt that the
 * account owner can read. That last part is not a nicety — an unfamiliar entry in
 * "recent activity" is realistically the only way anyone ever finds out someone
 * else has their password.
 */

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const LOCKOUT = {
  /** Consecutive failures before the account is locked. */
  threshold: int(process.env.LOGIN_LOCK_THRESHOLD, 8),
  /** Minutes the lock holds. */
  minutes: int(process.env.LOGIN_LOCK_MINUTES, 15),
  /** How long an attempt stays in the audit log. */
  auditDays: int(process.env.LOGIN_AUDIT_DAYS, 90),
};

/**
 * Why an attempt ended as it did.
 *
 * `recovery_code` is the odd one out — it labels a *successful* sign-in, and it
 * is here precisely because it is worth flagging in the activity log: somebody
 * getting in with a recovery code either lost their phone or is not the owner.
 */
export type AttemptReason =
  | 'no_account'
  | 'bad_password'
  | 'bad_totp'
  | 'bad_recovery'
  | 'locked'
  | 'recovery_code'
  | 'registration_closed';

/**
 * Records an attempt. Never throws: a full disk must not turn a correct password
 * into a failed sign-in.
 */
export async function recordAttempt(
  email: string,
  success: boolean,
  reason?: AttemptReason,
): Promise<void> {
  const { ip, userAgent } = await requestFingerprint();
  await prisma.loginAttempt
    .create({ data: { email: email.slice(0, 200), ip, userAgent, success, reason } })
    .catch(() => undefined);
}

/** Minutes remaining on a lock, or 0. */
export function lockRemaining(lockedUntil: Date | null | undefined): number {
  if (!lockedUntil) return 0;
  const ms = lockedUntil.getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}

/**
 * Counts a failure against the account and locks it once the threshold is hit.
 *
 * Deliberately *not* keyed on IP: an attacker distributes across addresses, so an
 * IP counter protects nothing while an account counter bounds the attack on the
 * account no matter where it comes from.
 *
 * The obvious objection is that this hands anyone a denial-of-service against a
 * known email. It is accepted here because the alternative — an unlimited
 * password oracle — is worse for a two-person household, the lock is 15 minutes
 * rather than permanent, and the owner can see in "recent activity" exactly what
 * is happening.
 */
export async function noteFailure(userId: string): Promise<void> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });

  if (user.failedLoginCount >= LOCKOUT.threshold) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        lockedUntil: new Date(Date.now() + LOCKOUT.minutes * 60_000),
        // Reset here, not on unlock: otherwise the ninth attempt after a lock
        // expires locks the account again immediately and it never reopens.
        failedLoginCount: 0,
      },
    });
  }
}

/** Clears the failure counter and any lock. Called on a completed sign-in. */
export async function noteSuccess(userId: string): Promise<void> {
  await prisma.user
    .update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } })
    .catch(() => undefined);
}

/** Recent attempts for the security screen. */
export async function recentAttempts(email: string, take = 20) {
  return prisma.loginAttempt.findMany({
    where: { email },
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, ip: true, userAgent: true, success: true, reason: true, createdAt: true },
  });
}

/**
 * Drops old audit rows. Called opportunistically from the security screen — this
 * table grows by a handful of rows a week for a household, and a cron job for
 * that would be more machinery than the problem.
 */
export async function pruneAttempts(): Promise<void> {
  const cutoff = new Date(Date.now() - LOCKOUT.auditDays * 86_400_000);
  await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => undefined);
}
