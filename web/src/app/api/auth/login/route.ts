import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  createSession,
  DUMMY_HASH,
  setSessionCookie,
  signTotpChallenge,
  upgradeHashIfNeeded,
  verifyPassword,
} from '@/lib/auth';
import { ApiError, handler, ok, tooManyRequests } from '@/lib/http';
import { lockRemaining, noteFailure, noteSuccess, recordAttempt } from '@/lib/login-guard';
import { callerIp, consume, LIMITS } from '@/lib/rate-limit';

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

/**
 * One message for every failure.
 *
 * "No such account", "wrong password" and "locked" are all the same string,
 * because telling them apart is what turns a leaked address list into a list of
 * addresses that have accounts here. The account owner sees the real reason in
 * their recent-activity log; the person guessing sees nothing.
 */
const REFUSED = 'E-mail ou senha inválidos.';

export const POST = handler(async (req: Request) => {
  const { email, password } = schema.parse(await req.json());

  /**
   * Throttled before the password is checked.
   *
   * Without this the endpoint is an unlimited online password oracle, which is
   * the single thing that makes exposing this app to the internet reckless. The
   * per-account budget is the one that matters: it bounds an attack on a
   * specific user regardless of how many addresses it arrives from. It is keyed
   * on the *submitted* address, so a non-existent account is throttled
   * identically and the response still reveals nothing about who has an account.
   *
   * This is the fast, in-memory half. The durable half — a lock that survives a
   * restart — is in lib/login-guard.ts, and both have to pass.
   */
  const ip = await callerIp();
  const gates = [
    consume(`login:acct:${email}`, LIMITS.loginPerAccount),
    ip ? consume(`login:ip:${ip}`, LIMITS.loginPerIp) : ({ ok: true } as const),
    consume('login:global', LIMITS.loginGlobal),
  ];
  for (const gate of gates) {
    if (!gate.ok) throw tooManyRequests(gate.retryAfterSeconds);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      lockedUntil: true,
      totpSecret: true,
      totpEnabledAt: true,
    },
  });

  /**
   * The hash is compared even when there is no account.
   *
   * `verifyPassword` against DUMMY_HASH burns the same ~250 ms bcrypt round as a
   * real check. Skipping it would make "no such user" return in a microsecond and
   * "wrong password" return in a quarter of a second — a difference wide enough
   * to enumerate a whole leak list over the internet, with no failed logins ever
   * recorded against a real account.
   */
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user) {
    await recordAttempt(email, false, 'no_account');
    throw new ApiError(401, REFUSED);
  }

  // Checked after the hash, for the same timing reason: a locked account must not
  // answer faster than an unlocked one.
  if (lockRemaining(user.lockedUntil) > 0) {
    await recordAttempt(email, false, 'locked');
    throw new ApiError(401, REFUSED);
  }

  if (!valid) {
    await recordAttempt(email, false, 'bad_password');
    await noteFailure(user.id);
    throw new ApiError(401, REFUSED);
  }

  // Right password, stored at an older work factor. The plaintext is in hand
  // exactly once — here — so this is the only place it can be upgraded.
  await upgradeHashIfNeeded(user.id, password, user.passwordHash);

  /**
   * Second factor, if the account has one.
   *
   * No session cookie is set yet. The challenge token proves only that the
   * password was correct, expires in five minutes, and is rejected as a session
   * by every route because it carries a different audience — so a stolen
   * challenge is worth nothing on its own.
   */
  if (user.totpEnabledAt && user.totpSecret) {
    return ok({ needsTotp: true, challenge: await signTotpChallenge(user.id) });
  }

  await noteSuccess(user.id);
  await recordAttempt(email, true);
  await setSessionCookie(await createSession({ sub: user.id, email: user.email, name: user.name }));

  return ok({ user: { id: user.id, name: user.name, email: user.email } });
});
