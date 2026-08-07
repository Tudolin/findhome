import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 time-based one-time passwords, and RFC 4648 base32 for the secret.
 *
 * ## Why hand-written rather than a library
 *
 * TOTP is HMAC-SHA1 over a counter plus a truncation rule — about sixty lines,
 * all of it specified, none of it changing. Against that, an auth dependency is a
 * thing that has to be trusted, updated, and audited for the lifetime of a
 * household app. The maths is below and it is verifiable against the RFC 6238
 * test vectors; that is a better trade here than a supply-chain relationship.
 *
 * ## What is deliberately NOT here
 *
 * Replay protection. A code is valid for the length of its step plus the
 * tolerance window — up to ~90 seconds — which is ample time for anyone who can
 * see the request to send it again. That is closed by recording the accepted step
 * on the user row and refusing it a second time (`User.totpLastStep`), and it
 * belongs there rather than here because it needs storage. `verifyTotp` returns
 * the step it matched precisely so the caller can do it.
 */

/** RFC 4648 base32, no padding — what every authenticator app expects. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Seconds per code. 30 is the universal default; changing it breaks every app. */
export const STEP_SECONDS = 30;
/** Digits in a code. Also universal. */
const DIGITS = 6;

/**
 * Steps of tolerance either side of now.
 *
 * 1 means a code is accepted from 30 seconds before until 30 seconds after its
 * own window — enough for a phone clock that has drifted and for a person typing
 * slowly, without widening the replay window beyond what the step counter closes.
 */
const DEFAULT_WINDOW = 1;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  // Authenticator apps show the secret in groups of four; people paste it back
  // with the spaces, and lower case happens. Neither should be a failure.
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const character of cleaned) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error('Not a base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * A fresh secret. 20 bytes is what RFC 4226 recommends for HMAC-SHA1 and what
 * every authenticator app is tested against.
 */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The TOTP code for a given step. Exported for the tests in the RFC. */
export function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  // 64-bit big-endian. `writeBigUInt64BE` rather than two 32-bit writes so the
  // high half is not silently dropped in 2038.
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();

  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks a
  // 4-byte window, and the top bit is masked off so the result is positive on
  // every platform.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const currentStep = (at: Date = new Date()) => Math.floor(at.getTime() / 1000 / STEP_SECONDS);

/**
 * Checks a code against the steps around now.
 *
 * Returns the step it matched — not a boolean — so the caller can persist it and
 * refuse the same step later. See the note at the top about replay.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { window?: number; at?: Date } = {},
): { ok: true; step: number } | { ok: false } {
  const cleaned = code.replace(/\D/g, '');
  if (cleaned.length !== DIGITS) return { ok: false };

  const window = options.window ?? DEFAULT_WINDOW;
  const now = currentStep(options.at);

  for (let offset = -window; offset <= window; offset += 1) {
    const step = now + offset;
    // Constant-time: comparing with === leaks, through timing, how many leading
    // digits were right. Both sides are fixed-length here so the lengths match.
    const expected = Buffer.from(codeForStep(secret, step));
    const given = Buffer.from(cleaned);
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The issuer appears twice — once as a prefix on the label and once as a
 * parameter — because that is what the (de facto) Key URI Format requires and
 * what stops the entry showing up as a bare email address among a dozen others.
 */
export function otpauthUri(secret: string, account: string, issuer = 'FindHome'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Groups of four, which is how every app displays a secret for manual entry. */
export const formatSecret = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();
