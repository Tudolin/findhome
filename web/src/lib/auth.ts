import { cookies } from 'next/headers';
// bcryptjs v3 is ESM-first and exposes named exports only — no default export.
import { compare, hash } from 'bcryptjs';
import {
  AUTH_COOKIE,
  SESSION_DAYS,
  WORKSPACE_COOKIE,
  signSession,
  verifySessionToken,
  type SessionPayload,
} from './jwt';

export { AUTH_COOKIE, WORKSPACE_COOKIE, signSession, verifySessionToken };
export type { SessionPayload };

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, 10);
}

export function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Home servers are commonly reached over plain http://192.168.x.x, which
    // would silently drop a Secure cookie. Set COOKIE_SECURE=true once TLS is
    // terminated by your reverse proxy.
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

/** Returns the signed-in user's session, or null. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
