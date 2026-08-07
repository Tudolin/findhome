import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createSession, setSessionCookie, verifyPassword, verifyTotpChallenge } from '@/lib/auth';
import { ApiError, handler, ok, tooManyRequests } from '@/lib/http';
import { noteFailure, noteSuccess, recordAttempt } from '@/lib/login-guard';
import { normalizeRecoveryCode } from '@/lib/password';
import { callerIp, consume, LIMITS } from '@/lib/rate-limit';
import { verifyTotp } from '@/lib/totp';

/**
 * Second step of a two-factor sign-in.
 *
 * Reached only with a challenge token from /api/auth/login, which proves the
 * password was already accepted and expires in five minutes.
 */

const schema = z.object({
  challenge: z.string().min(10),
  /** Six digits, or one of the ten recovery codes. */
  code: z.string().trim().min(6).max(20),
});

const REFUSED = 'Código inválido ou expirado.';

export const POST = handler(async (req: Request) => {
  const { challenge, code } = schema.parse(await req.json());

  /**
   * Throttled hard, and on its own budget.
   *
   * A TOTP code is six digits — one in a million per guess, but a million is not
   * a large number to a script, and by this point the attacker already has the
   * password. This gate is what keeps the second factor from being brute-forced
   * in an afternoon.
   */
  const ip = await callerIp();
  for (const gate of [
    consume(`totp:${challenge.slice(-24)}`, LIMITS.totpPerChallenge),
    ip ? consume(`totp:ip:${ip}`, LIMITS.totpPerIp) : ({ ok: true } as const),
  ]) {
    if (!gate.ok) throw tooManyRequests(gate.retryAfterSeconds);
  }

  const userId = await verifyTotpChallenge(challenge);
  if (!userId) throw new ApiError(401, 'Sessão de login expirou. Entre novamente.');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      totpSecret: true,
      totpEnabledAt: true,
      totpLastStep: true,
    },
  });
  if (!user?.totpSecret || !user.totpEnabledAt) throw new ApiError(401, REFUSED);

  const digits = code.replace(/\D/g, '');
  let accepted = false;
  let viaRecovery = false;

  if (digits.length === 6) {
    const result = verifyTotp(user.totpSecret, digits);
    /**
     * A step is accepted once.
     *
     * A code stays valid for up to ~90 seconds with the tolerance window, which
     * is ample time for anyone who can see the request to send it again.
     * Recording the step and refusing anything at or below it closes that.
     */
    if (result.ok && (user.totpLastStep === null || result.step > user.totpLastStep)) {
      accepted = true;
      await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: result.step } });
    }
  } else {
    // A recovery code. Hashed like a password, so this is a scan of the unused
    // ones rather than a lookup — ten bcrypt compares at worst, which is fine for
    // something used once a year and is what keeps the codes uncrackable if the
    // table leaks.
    const normalized = normalizeRecoveryCode(code);
    const candidates = await prisma.recoveryCode.findMany({
      where: { userId: user.id, usedAt: null },
      select: { id: true, codeHash: true },
    });

    for (const candidate of candidates) {
      if (await verifyPassword(normalized, candidate.codeHash)) {
        await prisma.recoveryCode.update({ where: { id: candidate.id }, data: { usedAt: new Date() } });
        accepted = true;
        viaRecovery = true;
        break;
      }
    }
  }

  if (!accepted) {
    await recordAttempt(user.email, false, digits.length === 6 ? 'bad_totp' : 'bad_recovery');
    await noteFailure(user.id);
    throw new ApiError(401, REFUSED);
  }

  await noteSuccess(user.id);
  // Flagged even though it succeeded: getting in with a recovery code means the
  // owner lost their phone, or it is not the owner.
  await recordAttempt(user.email, true, viaRecovery ? 'recovery_code' : undefined);
  await setSessionCookie(await createSession({ sub: user.id, email: user.email, name: user.name }));

  const remaining = viaRecovery
    ? await prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } })
    : null;

  return ok({
    user: { id: user.id, name: user.name, email: user.email },
    // Surfaced so the app can nag before the last one is spent — running out is
    // how a self-hosted account with no email delivery becomes unrecoverable.
    usedRecoveryCode: viaRecovery,
    recoveryCodesLeft: remaining,
  });
});
