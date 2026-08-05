import { SignJWT, jwtVerify } from 'jose';

/**
 * Edge-safe JWT helpers. Kept free of `next/headers` and bcryptjs so that
 * middleware (Edge runtime) can import it without pulling Node-only code in.
 */

export const AUTH_COOKIE = 'fh_token';
export const WORKSPACE_COOKIE = 'fh_workspace';

export const SESSION_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

export type SessionPayload = {
  sub: string; // user id
  email: string;
  name: string;
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

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer('findhome')
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'findhome' });
    if (!payload.sub) return null;
    return { sub: payload.sub, email: String(payload.email ?? ''), name: String(payload.name ?? '') };
  } catch {
    return null;
  }
}
