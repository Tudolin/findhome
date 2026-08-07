import { prisma } from './prisma';
import { verifyPassword } from './auth';
import { ApiError, tooManyRequests } from './http';
import { consume, LIMITS } from './rate-limit';
import { recordAttempt } from './login-guard';

/**
 * Re-checks the password before a security-critical change.
 *
 * ## Why a live session is not enough
 *
 * The threat this defends against is not a stranger on the internet — it is an
 * unlocked laptop. Someone with thirty seconds at a signed-in browser could
 * otherwise turn off two-factor, sign every other device out, and change the
 * password, locking the owner out of their own account permanently.
 *
 * Asking for the password again costs the owner a few seconds a year and costs
 * the passer-by everything, because a session cookie does not contain it.
 *
 * Applied to: enabling or disabling 2FA, regenerating recovery codes, changing
 * the password, and revoking sessions. Deliberately **not** applied to ordinary
 * use — nobody should be retyping a password to pin a flat.
 */
export async function requirePassword(userId: string, password: string): Promise<void> {
  const gate = consume(`stepup:${userId}`, LIMITS.stepUpPerUser);
  if (!gate.ok) throw tooManyRequests(gate.retryAfterSeconds);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });
  if (!user) throw new ApiError(401, 'Not authenticated');

  if (!(await verifyPassword(password, user.passwordHash))) {
    // Logged like a failed sign-in: from the owner's point of view, someone
    // guessing at their password inside a live session is the same event, and it
    // belongs in the same activity list.
    await recordAttempt(user.email, false, 'bad_password');
    throw new ApiError(401, 'Senha incorreta.');
  }
}
