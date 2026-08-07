import { headers } from 'next/headers';

/**
 * Fixed-window rate limiting for the endpoints that guess-ability makes
 * dangerous.
 *
 * ## Why in-memory
 *
 * This is a single-container app with one web process, so a Map is the whole
 * store. Redis would add a service to operate for no gain here. The trade-offs
 * are real and worth stating: counters reset when the container restarts, and if
 * you ever scale `web` to two replicas each gets its own budget.
 *
 * ## Why this is not the only defence
 *
 * An application-level limiter cannot see traffic that never reaches it and
 * cannot cheaply absorb a flood. If this app faces the internet, the proxy in
 * front of it must rate limit too — see the Security notes in the README. This
 * exists so that a brute-force attempt is bounded even when someone forgets, and
 * so a LAN deployment (where there is no proxy at all) is not defenceless.
 */

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

/**
 * Dropped on every check rather than on a timer: an interval would keep the
 * process awake and there is no eviction pressure worth a scheduler.
 */
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimit = { limit: number; windowMs: number };

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function consume(key: string, { limit, windowMs }: RateLimit): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

/**
 * The caller's address, or null when it cannot be known.
 *
 * `x-forwarded-for` is only meaningful behind a proxy you control — anyone can
 * send the header directly. Trusting it lets an attacker evade their own budget
 * (and, by claiming someone else's address, spend that address's budget), which
 * is why the per-IP limits below are generous and the per-account limit is the
 * one that actually protects a login. On a LAN deployment with no proxy the
 * header is absent and this returns null.
 */
export async function callerIp(): Promise<string | null> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-for');
  if (forwarded) {
    // Left-most entry is the original client, when the chain is trustworthy.
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return store.get('x-real-ip')?.trim() || null;
}

/** Budgets. Deliberately tight on the endpoints that are guessable. */
export const LIMITS = {
  /**
   * Per submitted email. This is the important one: it bounds an online
   * password-guessing attack on a specific account no matter how many addresses
   * the attacker comes from. Keyed on what was submitted, so it behaves
   * identically for an email that does not exist — no account enumeration.
   */
  loginPerAccount: { limit: 10, windowMs: 15 * 60_000 },
  /** Per address, when one is known. Loose, because the header is spoofable. */
  loginPerIp: { limit: 40, windowMs: 15 * 60_000 },
  /** Backstop for credential spraying across many accounts from anywhere. */
  loginGlobal: { limit: 400, windowMs: 15 * 60_000 },
  /** Account creation is rare and expensive; treat a burst as abuse. */
  registerPerIp: { limit: 5, windowMs: 60 * 60_000 },
  registerGlobal: { limit: 25, windowMs: 60 * 60_000 },

  /**
   * Second-factor guesses, per challenge token.
   *
   * A TOTP code is six digits. One in a million per guess sounds safe until you
   * notice a million is nothing to a script — and by this point the attacker
   * already has the password, so this is the last thing standing. Five guesses
   * per challenge means starting over (and re-submitting the password, which the
   * account lockout is counting) after every five.
   */
  totpPerChallenge: { limit: 5, windowMs: 10 * 60_000 },
  totpPerIp: { limit: 30, windowMs: 15 * 60_000 },

  /**
   * Step-up checks — the password re-entry guarding 2FA changes and session
   * revocation. Tighter than login: the caller is already signed in, so a burst
   * here is someone at a borrowed keyboard rather than a forgetful owner.
   */
  stepUpPerUser: { limit: 6, windowMs: 15 * 60_000 },
} satisfies Record<string, RateLimit>;
