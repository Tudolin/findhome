import { SignJWT, jwtVerify } from 'jose';

/**
 * Edge-safe JWT helpers. Kept free of `next/headers`, `node:crypto` and bcryptjs
 * so that middleware (Edge runtime) can import it without pulling Node-only code
 * in.
 *
 * ## What a valid token proves, and what it does not
 *
 * It proves the payload was signed by this server and has not expired. It does
 * **not** prove the session is still live — that lives in the `sessions` table
 * and is checked by `resolveSession` (lib/session.ts), which the Edge runtime
 * cannot reach. So the middleware is a cheap gate and the page/API layer is the
 * authority. That split is deliberate and is the same one `workspace.ts` already
 * documents for membership checks.
 */

export const AUTH_COOKIE = 'fh_token';
export const WORKSPACE_COOKIE = 'fh_workspace';

export const SESSION_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

/** Audience on a full session token. */
const AUD_SESSION = 'session';
/**
 * Audience on the short-lived token handed out between "password accepted" and
 * "second factor accepted".
 *
 * A separate audience, not a flag in the payload: a challenge token must be
 * unusable as a session even if it is placed in the session cookie by accident or
 * on purpose. `jwtVerify` rejects the wrong audience outright, so the mistake
 * cannot be made.
 */
const AUD_CHALLENGE = 'totp-challenge';

/** Minutes to finish the second factor before starting over. */
const CHALLENGE_MINUTES = 5;

export type SessionPayload = {
  sub: string; // user id
  email: string;
  name: string;
  /** Token id. The key into the `sessions` table; absent on legacy tokens. */
  jti?: string;
};

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'JWT_SECRET is missing or shorter than 32 characters. Generate one with: openssl rand -base64 48',
    );
  }
  return new TextEncoder().encode(value);
}

export async function signSession(payload: SessionPayload, jti: string): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setJti(jti)
    .setIssuedAt()
    .setIssuer('findhome')
    .setAudience(AUD_SESSION)
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: 'findhome',
      audience: AUD_SESSION,
    });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      jti: typeof payload.jti === 'string' ? payload.jti : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The token that carries "this password was correct" across to the 2FA step.
 *
 * Deliberately minimal: a subject and five minutes. It grants nothing on its own
 * — every route rejects it as a session because of the audience — and it exists
 * only so the password does not have to be held in the browser, or re-sent, while
 * the code is typed.
 */
export async function signTotpChallenge(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer('findhome')
    .setAudience(AUD_CHALLENGE)
    .setExpirationTime(`${CHALLENGE_MINUTES}m`)
    .sign(secret());
}

/** Returns the user id the challenge was issued for, or null. */
export async function verifyTotpChallenge(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: 'findhome',
      audience: AUD_CHALLENGE,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}
