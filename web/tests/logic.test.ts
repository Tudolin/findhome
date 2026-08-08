import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreProperty } from '../src/lib/scoring';
import { countActiveFilters, hrefWith, parseFilters } from '../src/lib/feed-params';
import { daysListed, isNotablePriceMove, priceSignal, SITTING_DAYS } from '../src/lib/signals';
import { entryCost, rentalUpfront } from '../src/lib/costs';
import { assessPassword, MIN_LENGTH, normalizeRecoveryCode } from '../src/lib/password';
import { displayImages, galleryFor } from '../src/lib/media';

/**
 * The pure logic behind the decisions the app makes.
 *
 * Every case here corresponds to a rule that is stated in a comment somewhere and
 * would otherwise only be checked by reading. The ones that matter most are the
 * ones where being wrong is *silent*: a filter that quietly widens, a gallery
 * that quietly renders dead URLs, a ranking that quietly rewards the wrong thing.
 */

const rater = (userId: string, rating: number | null, status = 'INTERESTED' as const) => ({
  userId,
  rating,
  status,
  pros: [] as string[],
  cons: [] as string[],
});

describe('party scoring', () => {
  it('rewards agreement over a single high rating', () => {
    // The engine's whole premise, stated in scoring.ts: "a property both partners
    // rated 4 outranks one that a single partner rated 5".
    const bothFour = scoreProperty([rater('a', 4), rater('b', 4)], 2);
    const oneFive = scoreProperty([rater('a', 5)], 2);
    assert.ok(
      bothFour.score > oneFive.score,
      `expected agreement to win: ${bothFour.score} vs ${oneFive.score}`,
    );
  });

  it('heavily discounts a veto from any member', () => {
    const liked = scoreProperty([rater('a', 5), rater('b', 5)], 2);
    const vetoed = scoreProperty([rater('a', 5), rater('b', 5, 'REJECTED')], 2);
    assert.equal(vetoed.vetoed, true);
    assert.ok(vetoed.score < liked.score * 0.5);
  });

  it('flags a conflict when ratings differ by three or more', () => {
    assert.equal(scoreProperty([rater('a', 5), rater('b', 2)], 2).conflict, true);
    assert.equal(scoreProperty([rater('a', 4), rater('b', 3)], 2).conflict, false);
  });

  it('does not report a rejected-only property as merely undiscovered', () => {
    // Seeding bestStatus from DISCOVERED would rank REJECTED *above* it and the
    // property would vanish from the board. See the note in scoring.ts.
    assert.equal(scoreProperty([rater('a', 1, 'REJECTED')], 1).bestStatus, 'REJECTED');
  });

  it('survives an empty interaction list', () => {
    const empty = scoreProperty([], 2);
    assert.equal(empty.avgRating, null);
    assert.equal(empty.ratedCount, 0);
  });
});

describe('feed URL round-trip', () => {
  it('preserves repeated parameters', () => {
    // The bug this exists for: the old helper used `set()`, which collapsed
    // `?source=OLX&source=ZAP` to its first value — so paging away from page 1
    // silently WIDENED the search.
    const href = hrefWith('/dashboard', { source: ['OLX', 'ZAP'], q: 'batel' }, { page: 3 });
    const params = new URL(href, 'http://x').searchParams;
    assert.deepEqual(params.getAll('source'), ['OLX', 'ZAP']);
    assert.equal(params.get('q'), 'batel');
    assert.equal(params.get('page'), '3');
  });

  it('drops a key when the override is null', () => {
    // How "back to page 1" is expressed without leaving `?page=` behind.
    const href = hrefWith('/dashboard', { page: '4', q: 'x' }, { page: null });
    assert.equal(href, '/dashboard?q=x');
  });

  it('returns the bare path when nothing is left', () => {
    assert.equal(hrefWith('/dashboard', {}, {}), '/dashboard');
  });

  it('parses comma-separated and repeated multi-values identically', () => {
    const a = parseFilters({ source: 'OLX,ZAP' });
    const b = parseFilters({ source: ['OLX', 'ZAP'] });
    assert.deepEqual(a.sources, b.sources);
    assert.deepEqual(a.sources, ['OLX', 'ZAP']);
  });

  it('treats pets as three states, not two', () => {
    // "any policy" has to stay distinguishable from "explicitly not pet friendly",
    // or the filter cannot be turned off.
    assert.equal(parseFilters({}).petFriendly, undefined);
    assert.equal(parseFilters({ pets: 'yes' }).petFriendly, true);
    assert.equal(parseFilters({ pets: 'no' }).petFriendly, false);
  });

  it('counts each selected multi-value as its own active filter', () => {
    assert.equal(countActiveFilters({ neighborhood: ['batel', 'agua-verde'] }), 2);
    assert.equal(countActiveFilters({ q: 'ignored', sort: 'newest' }), 0);
  });
});

describe('price signals', () => {
  const point = (totalPrice: number, delta: number) => ({ totalPrice, delta, seenAt: new Date() });

  it('reports a cut as a negative change', () => {
    const signal = priceSignal([point(3000, 0), point(2800, -200)]);
    assert.equal(signal?.changeSinceFirst, -200);
    assert.equal(signal?.direction, 'down');
    assert.equal(signal?.moves, 1);
  });

  it('reports no movement on a flat history', () => {
    assert.equal(priceSignal([point(3000, 0)])?.direction, 'flat');
    assert.equal(priceSignal([])?.changeSinceFirst, undefined);
  });

  it('suppresses noise below the notability threshold', () => {
    // 2% or R$100, whichever is larger — a R$20 move on a R$3.000 rent is noise,
    // and badging it trains people to ignore badges.
    assert.equal(isNotablePriceMove(-20, 3000), false);
    assert.equal(isNotablePriceMove(-100, 3000), true);
    assert.equal(isNotablePriceMove(-100, 100000), false);
    assert.equal(isNotablePriceMove(-5000, 100000), true);
  });

  it('measures days listed from the creation date', () => {
    const days = 3;
    assert.equal(daysListed(new Date(Date.now() - days * 86_400_000)), days);
    assert.equal(daysListed(new Date()), 0);
    assert.ok(SITTING_DAYS > 0);
  });
});

describe('purchase and rental costs', () => {
  it('adds several per cent to an asking price', () => {
    const cost = entryCost(650_000);
    assert.ok(cost.fees > 0);
    assert.equal(cost.total, 650_000 + cost.fees);
    // Defaults are 3% + 1% + 0.8%.
    assert.ok(cost.feesPct > 0.04 && cost.feesPct < 0.06, `unexpected ${cost.feesPct}`);
  });

  it('waives the deed when the purchase is financed', () => {
    // A financed purchase is registered from the bank contract, so there is no
    // separate escritura — a real several-thousand-reais difference.
    assert.equal(entryCost(650_000, { financed: true }).deed, 0);
    assert.ok(entryCost(650_000, { financed: true }).total < entryCost(650_000).total);
  });

  it('returns a range for a rental, because the guarantee decides it', () => {
    const range = rentalUpfront(3000, 500);
    assert.equal(range.min, 3500);
    assert.equal(range.max, 3500 + 9000);
    assert.ok(range.max > range.min);
  });
});

describe('password policy', () => {
  it('requires real length', () => {
    assert.equal(assessPassword('short').ok, false);
    assert.ok(MIN_LENGTH >= 12);
  });

  it('rejects the passwords that are guessed first', () => {
    for (const bad of ['senha123456789', 'password12345', 'minhasenha123']) {
      assert.equal(assessPassword(bad).ok, false, `accepted "${bad}"`);
    }
  });

  it('rejects sequences and repetition', () => {
    assert.equal(assessPassword('abcdefghijklmno').ok, false);
    assert.equal(assessPassword('aaaaaaaaaaaaaaa').ok, false);
  });

  it('rejects a password built from the account it protects', () => {
    assert.equal(assessPassword('anaSilva!2026xyz', { email: 'anasilva@x.com' }).ok, true);
    assert.equal(assessPassword('anasilva-mudanca', { email: 'anasilva@x.com' }).ok, false);
    assert.equal(assessPassword('rodrigo-mudanca26', { name: 'Rodrigo Lima' }).ok, false);
  });

  it('accepts a long passphrase with no symbols', () => {
    // The composition-rule mistake this policy is written to avoid: a memorable
    // passphrase is strong and must not be rejected for lacking a digit.
    const verdict = assessPassword('cavalo bateria grampo correto');
    assert.equal(verdict.ok, true);
  });

  it('rejects leading or trailing whitespace', () => {
    // Invisible, pasted from a manager, and the login then fails forever.
    assert.equal(assessPassword(' cavalo bateria grampo ').ok, false);
  });

  it('normalises recovery codes so case and the dash do not matter', () => {
    assert.equal(normalizeRecoveryCode('abcd-2345'), 'ABCD2345');
    assert.equal(normalizeRecoveryCode('ABCD2345'), 'ABCD2345');
  });
});

describe('gallery resolution', () => {
  const remote = 'https://img.olx.com.br/images/12/123456.jpg';
  const withQuery = `${remote}?v=2`;

  it('swaps in the mirrored copy, matching on the query-stripped URL', () => {
    const out = displayImages({
      images: [withQuery],
      photos: [{ remoteUrl: remote, path: 'ab/cd.webp' }],
    });
    assert.deepEqual(out, ['/media/ab/cd.webp']);
  });

  it('falls back to the portal URL when nothing is mirrored', () => {
    assert.deepEqual(displayImages({ images: [remote], photos: [] }), [remote]);
    assert.deepEqual(displayImages({ images: [remote] }), [remote]);
  });

  it('renders ONLY mirrored copies for a closed ad', () => {
    // A closed ad's URLs die with it, so rendering them produces a wall of grey.
    // The rest is reported as `missing` so the UI can say so.
    const view = galleryFor({
      active: false,
      images: [remote, 'https://img.olx.com.br/images/12/999.jpg'],
      photos: [{ remoteUrl: remote, path: 'ab/cd.webp' }],
    });
    assert.deepEqual(view.images, ['/media/ab/cd.webp']);
    assert.equal(view.missing, 1);
    assert.equal(view.total, 2);
    assert.equal(view.archived, true);
  });

  it('leaves a live listing untouched', () => {
    const view = galleryFor({ active: true, images: [remote], photos: [] });
    assert.deepEqual(view.images, [remote]);
    assert.equal(view.missing, 0);
    assert.equal(view.archived, false);
  });
});
