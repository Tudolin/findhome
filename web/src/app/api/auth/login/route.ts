import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { setSessionCookie, signSession, verifyPassword } from '@/lib/auth';
import { ApiError, handler, ok, tooManyRequests } from '@/lib/http';
import { callerIp, consume, LIMITS } from '@/lib/rate-limit';

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

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

  const user = await prisma.user.findUnique({ where: { email } });
  // Same message and roughly the same work either way, so the response does
  // not reveal whether the email exists.
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) throw new ApiError(401, 'Invalid email or password');

  await setSessionCookie(await signSession({ sub: user.id, email: user.email, name: user.name }));

  return ok({ user: { id: user.id, name: user.name, email: user.email } });
});
