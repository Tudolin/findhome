import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { base32Decode, base32Encode, codeForStep, otpauthUri, verifyTotp } from '../src/lib/totp';

/**
 * The most important test file in the repository.
 *
 * `lib/totp.ts` is hand-written cryptography guarding the second factor of a
 * publicly reachable login. It cannot be verified by reading it — an off-by-one
 * in the dynamic-truncation offset, or a byte order slip in the counter, produces
 * codes that look exactly as random as correct ones and fail only against a real
 * authenticator app, at which point the account is locked out.
 *
 * So it is checked against the published RFC 6238 test vectors. If these pass, the
 * implementation agrees with Google Authenticator, Authy, 1Password and Bitwarden
 * by construction rather than by hope.
 */

/**
 * RFC 6238 Appendix B, the SHA-1 seed: the ASCII string "12345678901234567890",
 * base32-encoded, which is what an authenticator app would be given.
 */
const SEED = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

/**
 * The published vectors. The RFC lists 8-digit codes; this implementation emits
 * 6, which is the universal default, so the expectation is the last six digits —
 * truncation is modulo 10^digits, so the low digits are shared.
 */
const VECTORS: Array<{ time: number; eightDigit: string }> = [
  { time: 59, eightDigit: '94287082' },
  { time: 1111111109, eightDigit: '07081804' },
  { time: 1111111111, eightDigit: '14050471' },
  { time: 1234567890, eightDigit: '89005924' },
  { time: 2000000000, eightDigit: '69279037' },
  { time: 20000000000, eightDigit: '65353130' },
];

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const input of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', '12345678901234567890']) {
      const bytes = Buffer.from(input, 'ascii');
      assert.deepEqual(base32Decode(base32Encode(bytes)), bytes, `failed for "${input}"`);
    }
  });

  it('accepts the spacing and casing an authenticator app displays', () => {
    // People paste the secret back with its display grouping and in lower case.
    // Both have to decode to the same key, or manual entry silently produces
    // wrong codes forever.
    const canonical = base32Decode(SEED);
    assert.deepEqual(base32Decode(SEED.toLowerCase()), canonical);
    assert.deepEqual(base32Decode(SEED.replace(/(.{4})/g, '$1 ').trim()), canonical);
    assert.deepEqual(base32Decode(`${SEED}====`), canonical);
  });

  it('rejects characters outside the alphabet', () => {
    assert.throws(() => base32Decode('ABC!'), /base32/i);
  });
});

describe('TOTP against the RFC 6238 vectors', () => {
  for (const { time, eightDigit } of VECTORS) {
    it(`T=${time} produces ${eightDigit.slice(-6)}`, () => {
      const step = Math.floor(time / 30);
      assert.equal(codeForStep(SEED, step), eightDigit.slice(-6));
    });
  }

  it('handles counters past 2^32', () => {
    // The last vector (T=20000000000) is what catches a 32-bit counter write.
    // Without a 64-bit big-endian counter this is silently wrong from 2038 —
    // and, more immediately, wrong for that vector today.
    assert.equal(codeForStep(SEED, Math.floor(20000000000 / 30)), '353130');
  });
});

describe('verifyTotp', () => {
  const at = (seconds: number) => new Date(seconds * 1000);

  it('accepts the current code and reports its step', () => {
    const result = verifyTotp(SEED, '287082', { at: at(59) });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.step, 1);
  });

  it('accepts one step either side, for clock drift', () => {
    // A phone 25 seconds fast still works; this is the whole reason for a window.
    assert.equal(verifyTotp(SEED, codeForStep(SEED, 100), { at: at(100 * 30) }).ok, true);
    assert.equal(verifyTotp(SEED, codeForStep(SEED, 99), { at: at(100 * 30) }).ok, true);
    assert.equal(verifyTotp(SEED, codeForStep(SEED, 101), { at: at(100 * 30) }).ok, true);
  });

  it('rejects two steps away', () => {
    assert.equal(verifyTotp(SEED, codeForStep(SEED, 98), { at: at(100 * 30) }).ok, false);
    assert.equal(verifyTotp(SEED, codeForStep(SEED, 102), { at: at(100 * 30) }).ok, false);
  });

  it('rejects anything that is not six digits', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56']) {
      assert.equal(verifyTotp(SEED, bad, { at: at(59) }).ok, false, `accepted "${bad}"`);
    }
  });

  it('returns a step the caller can use to block replay', () => {
    // The route stores this and refuses anything at or below it. Without a step
    // in the result there is no way to close the ~90-second replay window.
    const result = verifyTotp(SEED, codeForStep(SEED, 500), { at: at(500 * 30) });
    assert.equal(result.ok && result.step, 500);
  });
});

describe('otpauthUri', () => {
  it('carries the issuer twice, as the Key URI Format requires', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'ana@example.com');
    assert.match(uri, /^otpauth:\/\/totp\//);
    // Once in the label, so the entry is not a bare email among a dozen others…
    assert.ok(uri.includes(encodeURIComponent('FindHome:ana@example.com')));
    // …and once as a parameter, which is what apps actually read.
    assert.match(uri, /issuer=FindHome/);
    assert.match(uri, /digits=6/);
    assert.match(uri, /period=30/);
    assert.match(uri, /algorithm=SHA1/);
  });
});
