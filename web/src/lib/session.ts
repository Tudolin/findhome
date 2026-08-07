import { createHash, randomBytes, randomInt } from 'node:crypto';
import { headers } from 'next/headers';
import { prisma } from './prisma';
import { RECOVERY_ALPHABET } from './password';
import { SESSION_DAYS, signSession, verifySessionToken, type SessionPayload } from './jwt';

/**
 * Server-side session records.
 *
 * The JWT proves *who*; this table decides *whether still*. Splitting the two is
 * what turns "signed out" from a client-side gesture into a fact — see the note
 * on the Session model in schema.prisma.
 *
 * Every request pays one indexed lookup for it. At household scale that is
 * nothing, and it buys revocation, per-device sign-out, and password changes that
 * actually mean something.
 */

/** The token id is the secret; only its digest is stored. */
export const hashToken = (jti: string) => createHash('sha256').update(jti).digest('hex');

/** `lastSeenAt` is a human-facing timestamp, not an audit trail. */
const TOUCH_INTERVAL_MS = 60_000;

/** Trimmed because it is a label on a screen, not something to parse. */
function shorten(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** What the browser looks like, for the "your devices" list. */
export async function requestFingerprint(): Promise<{ userAgent: string | null; ip: string | null }> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || store.get('x-real-ip')?.trim() || null;
  return { userAgent: shorten(store.get('user-agent'), 300), ip: shorten(ip, 64) };
}

/**
 * Issues a session and returns the cookie value.
 *
 * The `jti` is 32 random bytes, so it is the actual bearer secret — the JWT
 * signature stops it being forged, and the row stops a valid signature outliving
 * a sign-out.
 */
export async function createSession(payload: SessionPayload): Promise<string> {
  const jti = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const { userAgent, ip } = await requestFingerprint();

  await prisma.session.create({
    data: { userId: payload.sub, tokenHash: hashToken(jti), userAgent, ip, expiresAt },
  });

  return signSession(payload, jti);
}

export type ResolvedSession = SessionPayload & { sessionId: string };

/**
 * Verifies a cookie against both the signature and the session table.
 *
 * Returns null for every failure — expired, revoked, unknown, or issued before
 * the password last changed. The caller cannot tell them apart, and should not:
 * they all mean "sign in again".
 */
export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const payload = await verifySessionToken(token);
  if (!payload?.jti) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(payload.jti) },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
      lastSeenAt: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true, passwordChangedAt: true } },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  /**
   * A session issued before the current password is dead.
   *
   * This is the check that makes "change your password" a real response to a
   * compromise. Without it, changing the password locks nobody out — an
   * attacker's existing cookie keeps working for the rest of its 30 days.
   *
   * Compared against `createdAt`, not `lastSeenAt`: when the session was issued
   * is the fact that matters, and `lastSeenAt` moves forward on every request,
   * which would let exactly the session being defended against keep itself alive.
   */
  const changedAt = session.user.passwordChangedAt;
  if (changedAt && session.createdAt < changedAt) return null;

  // Throttled: a write on every request would turn a read path into a write path
  // for a value nobody reads more than once a week.
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const { ip, userAgent } = await requestFingerprint();
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(), ip, userAgent } })
      .catch(() => undefined);
  }

  return {
    sub: session.user.id,
    email: session.user.email,
    name: session.user.name,
    jti: payload.jti,
    sessionId: session.id,
  };
}

/** Signs one device out. */
export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  const { count } = await prisma.session.updateMany({
    // The userId is part of the filter, not just the lookup: without it, anyone
    // with a session id could sign out anyone else.
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count > 0;
}

/** Signs everything out, optionally sparing the device asking. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return count;
}

/** Live sessions for the security screen, newest first. */
export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true },
    take: 50,
  });
}

/**
 * Drops rows nobody can use any more.
 *
 * Called opportunistically from the security screen rather than on a schedule:
 * this table grows by one row per sign-in, which for a household is a handful a
 * week, and a cron job for that would be more machinery than the problem.
 */
export async function pruneSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  await prisma.session
    .deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
    })
    .catch(() => undefined);
}

/**
 * Ten recovery codes, in `XXXX-XXXX` form.
 *
 * `randomInt` from node:crypto, not `Math.random()`. These are a password
 * equivalent — the whole point is that they let someone in without the second
 * factor — and `Math.random()` is a seeded PRNG whose output is predictable from
 * a handful of samples. Rejection-free because 32 divides evenly into the range.
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let n = 0; n < count; n += 1) {
    let code = '';
    for (let i = 0; i < 8; i += 1) code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}
