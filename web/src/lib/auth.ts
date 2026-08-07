import { cookies } from 'next/headers';
// bcryptjs v3 is ESM-first and exposes named exports only — no default export.
import { compare, hash } from 'bcryptjs';
import { prisma } from './prisma';
import {
  AUTH_COOKIE,
  SESSION_DAYS,
  WORKSPACE_COOKIE,
  signTotpChallenge,
  verifyTotpChallenge,
  verifySessionToken,
  type SessionPayload,
} from './jwt';
import {
  createSession,
  requestFingerprint,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  type ResolvedSession,
} from './session';

export { AUTH_COOKIE, WORKSPACE_COOKIE, verifySessionToken, signTotpChallenge, verifyTotpChallenge };
export { createSession, resolveSession, revokeAllSessions, revokeSession, requestFingerprint };
export type { SessionPayload, ResolvedSession };

/**
 * Work factor for bcrypt.
 *
 * Raised from 10. Each step doubles the cost of both a legitimate login and an
 * offline crack of a stolen hash — 12 is ~250 ms on a modest CPU, which is
 * unnoticeable once per sign-in and four times the attacker's bill. Existing
 * hashes keep their old factor and are silently upgraded on the next successful
 * sign-in (see `upgradeHashIfNeeded`).
 */
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}

/**
 * Re-hashes a password that was stored at a lower work factor.
 *
 * Called after a successful sign-in, when the plaintext is in hand and nowhere
 * else. Without this, raising BCRYPT_ROUNDS only protects accounts created after
 * the change — which is the opposite of the accounts that need it, since the old
 * ones have had longer to leak.
 */
export async function upgradeHashIfNeeded(userId: string, plain: string, current: string): Promise<void> {
  const rounds = Number(current.split('$')[2]);
  if (!Number.isFinite(rounds) || rounds >= BCRYPT_ROUNDS) return;
  await prisma.user
    .update({ where: { id: userId }, data: { passwordHash: await hashPassword(plain) } })
    .catch(() => undefined);
}

/**
 * A dummy hash, compared against when the account does not exist.
 *
 * Without it, "no such user" returns in a microsecond and "wrong password"
 * returns after a bcrypt round — a timing difference big enough to enumerate
 * every address in a leak list. Burning the same work either way removes the
 * signal. The value is a real bcrypt hash of a random string; nothing matches it.
 */
export const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.4hDlfHiTiFXVc6gWPtVJHzq5EYE0aOu';

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(AUTH_COOKIE, token, {
    httpOnly: true,
    // `lax`, not `strict`: `strict` drops the cookie when arriving from an
    // external link, so following a shared listing URL would land on /login even
    // while signed in. Lax still blocks the cross-site POSTs that matter, and the
    // Origin check in lib/http.ts covers the rest.
    sameSite: 'lax',
    // Home servers are commonly reached over plain http://192.168.x.x, which
    // would silently drop a Secure cookie. Set COOKIE_SECURE=true once TLS is
    // terminated by your reverse proxy or tunnel.
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  store.delete(WORKSPACE_COOKIE);
}

/**
 * The signed-in user, or null.
 *
 * This is the authoritative check: signature *and* a live session row. The
 * middleware's cheaper version can be fooled by a token whose session has since
 * been revoked; this one cannot.
 */
export async function getSession(): Promise<ResolvedSession | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return resolveSession(token);
}
