import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MIN_DESCRIPTION, pickDescription } from '../src/description.js';

/** A body of prose of a given length, so the tests read by intent, not by count. */
const prose = (length: number, seed = 'Apartamento reformado com sol da manhã e vista livre. ') =>
  seed.repeat(Math.ceil(length / seed.length)).slice(0, length);

describe('pickDescription', () => {
  it('takes the longest candidate, because they are the same text truncated', () => {
    const short = prose(120) + '…';
    const full = prose(900);
    assert.equal(pickDescription([short, full], null), full);
    // Order must not matter — the DOM strategy can run before or after ld+json.
    assert.equal(pickDescription([full, short], null), full);
  });

  it('ignores candidates too short to be an advertiser description', () => {
    assert.equal(pickDescription(['Descrição', 'Sobre o imóvel', ''], null), null);
    assert.equal(pickDescription([prose(MIN_DESCRIPTION - 1)], null), null);
  });

  it('rejects the portal marketing line that og:description usually carries', () => {
    // Longer than the real description, so length alone would pick it.
    const marketing = 'Encontre o imóvel ideal na maior plataforma do Brasil. ' + prose(400);
    const real = prose(200);
    assert.equal(pickDescription([marketing, real], null), real);
  });

  it('collapses whitespace so formatting cannot beat content', () => {
    const padded = `  ${prose(100)}\n\n\n   ${prose(100)}  `;
    const picked = pickDescription([padded], null);
    assert.ok(picked);
    assert.ok(!/\s{2}/.test(picked), 'runs of whitespace should be collapsed');
    assert.equal(picked, picked.trim());
  });

  it('caps at the column width persist.ts uses', () => {
    const picked = pickDescription([prose(9000)], null);
    assert.equal(picked?.length, 4000);
  });

  it('keeps the stored description when the page offers nothing better', () => {
    const stored = prose(500);
    // Same text, re-read on a retry.
    assert.equal(pickDescription([stored], stored), null);
    // Trivially different — must not rewrite the row on every revisit, which is
    // the failure mode the retry branch made possible.
    assert.equal(pickDescription([`  ${stored}  `], stored), null);
    assert.equal(pickDescription([prose(510)], stored), null);
  });

  it('replaces the stored description when the page has a genuinely fuller one', () => {
    const truncated = prose(160) + '…';
    const full = prose(1200);
    assert.equal(pickDescription([full], truncated), full);
  });

  it('fills in an empty description — the OLX case', () => {
    const full = prose(300);
    assert.equal(pickDescription([full], null), full);
    assert.equal(pickDescription([full], ''), full);
    assert.equal(pickDescription([full], '   '), full);
  });

  it('returns null when the page yielded nothing at all', () => {
    assert.equal(pickDescription([], null), null);
    assert.equal(pickDescription([], prose(200)), null);
  });
});
