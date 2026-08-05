import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { setSessionCookie, signSession, verifyPassword } from '@/lib/auth';
import { ApiError, handler, ok } from '@/lib/http';

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const POST = handler(async (req: Request) => {
  const { email, password } = schema.parse(await req.json());

  const user = await prisma.user.findUnique({ where: { email } });
  // Same message and roughly the same work either way, so the response does
  // not reveal whether the email exists.
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) throw new ApiError(401, 'Invalid email or password');

  await setSessionCookie(await signSession({ sub: user.id, email: user.email, name: user.name }));

  return ok({ user: { id: user.id, name: user.name, email: user.email } });
});
