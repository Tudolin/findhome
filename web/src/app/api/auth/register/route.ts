import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createSession, hashPassword, setSessionCookie, WORKSPACE_COOKIE } from '@/lib/auth';
import { badRequest, conflict, forbidden, handler, ok, tooManyRequests } from '@/lib/http';
import { assessPassword, MAX_LENGTH } from '@/lib/password';
import { callerIp, consume, LIMITS } from '@/lib/rate-limit';

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  // Length is checked here only to bound the bcrypt input; the real policy is
  // `assessPassword` below, which needs the name and email to compare against.
  password: z.string().min(1).max(MAX_LENGTH),
  inviteCode: z.string().trim().toUpperCase().optional().or(z.literal('')),
});

export const POST = handler(async (req: Request) => {
  // A home server on the open internet should not accept anonymous signups.
  // Set ALLOW_REGISTRATION=false once your household has accounts.
  if (process.env.ALLOW_REGISTRATION === 'false') {
    throw forbidden('Registration is disabled on this server');
  }

  // Creating an account is rare and costs a bcrypt hash, so a burst is abuse.
  // This only matters while registration is open — which it should not be once
  // the household has its accounts.
  const ip = await callerIp();
  for (const gate of [
    ip ? consume(`register:ip:${ip}`, LIMITS.registerPerIp) : ({ ok: true } as const),
    consume('register:global', LIMITS.registerGlobal),
  ]) {
    if (!gate.ok) throw tooManyRequests(gate.retryAfterSeconds);
  }

  const { name, email, password, inviteCode } = schema.parse(await req.json());

  // Policy before the database, so a rejected password costs no query. Checked
  // against the name and email too — a password built from the account it
  // protects is the first thing anyone tries.
  const verdict = assessPassword(password, { email, name });
  if (!verdict.ok) throw badRequest(verdict.reason);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict('An account with that email already exists');

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      // Baseline for the "sessions issued before the current password are dead"
      // check in resolveSession. Without it, the first password change would have
      // nothing to compare against.
      passwordChangedAt: new Date(),
    },
  });

  // Optional: join a party straight from the registration form.
  let joinedParty: { id: string; name: string } | null = null;
  if (inviteCode) {
    const party = await prisma.party.findUnique({ where: { inviteCode } });
    if (party) {
      await prisma.partyMember.create({ data: { partyId: party.id, userId: user.id, role: 'MEMBER' } });
      joinedParty = { id: party.id, name: party.name };

      // Land them in the party they were invited to rather than an empty solo
      // workspace — otherwise the invite appears to have done nothing.
      const store = await cookies();
      store.set(WORKSPACE_COOKIE, party.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        path: '/',
        maxAge: 365 * 24 * 60 * 60,
      });
    }
  }

  await setSessionCookie(await createSession({ sub: user.id, email: user.email, name: user.name }));

  return ok({ user: { id: user.id, name: user.name, email: user.email }, joinedParty }, 201);
});
