import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dedupe, photoKey, photoUpdate } from '../src/photo-merge.js';

/**
 * The guard that stops a re-scrape destroying a backfilled gallery.
 *
 * This is the highest-consequence pure function in the scraper. Getting it wrong
 * is silent and total: a plain `update` writes the SEARCH RESULT's photos over
 * whatever is stored, and on OLX, Chaves na Mão and ImovelWeb that is exactly one
 * cover photo. Every gallery the backfill filled would be destroyed on the next
 * run — and because `photosFetchedAt` is already stamped, never refetched. The
 * carousels would quietly collapse back to one photo a few hours after being
 * filled, with nothing in any log to say why.
 */

const gallery = (...urls: string[]) => ({ images: urls, photosFetchedAt: new Date('2026-01-01') });

const A = 'https://img.olx.com.br/images/a.jpg';
const B = 'https://img.olx.com.br/images/b.jpg';
const C = 'https://img.olx.com.br/images/c.jpg';

describe('photoUpdate', () => {
  it('keeps a backfilled gallery when the search returns only the cover', () => {
    // The case that matters. OLX's search response is one photo; the stored
    // gallery is twelve. The stored one must win.
    const result = photoUpdate([A], gallery(A, B, C));
    assert.deepEqual(result, {}, 'a cover-only re-scrape must change nothing');
  });

  it('changes nothing when the set is identical', () => {
    assert.deepEqual(photoUpdate([A, B], gallery(A, B)), {});
  });

  it('ignores a changed query string on the same photo', () => {
    // These CDNs decorate one file with per-request parameters. Comparing full
    // URLs reports "new photo" on every run, which clears photosFetchedAt and
    // re-queues the listing forever — consuming the whole backfill budget on
    // listings that are already done.
    assert.deepEqual(photoUpdate([`${A}?v=2`], gallery(A, B)), {});
  });

  it('takes genuinely new photos, keeping the ones already held', () => {
    const result = photoUpdate([A, C], gallery(A, B));
    assert.ok(result.images, 'expected an update');
    // Union, not replace: the portal reordering its carousel must not throw away
    // photos the listing page gave us.
    assert.equal(new Set(result.images).size, 3);
    assert.ok(result.images!.includes(B), 'dropped a stored photo');
    assert.ok(result.images!.includes(C), 'missed the new photo');
    assert.equal(result.photoCount, 3);
  });

  it('re-queues the backfill when the listing really changed', () => {
    // The ad was re-shot, so its page may now have more than last time.
    assert.equal(photoUpdate([C], gallery(A)).photosFetchedAt, null);
  });

  it('does not re-queue when nothing changed', () => {
    assert.equal('photosFetchedAt' in photoUpdate([A], gallery(A, B)), false);
  });

  it('handles an empty incoming set', () => {
    // A parser that found nothing this run must not be read as "delete them all".
    assert.deepEqual(photoUpdate([], gallery(A, B)), {});
  });

  it('handles an empty stored set', () => {
    const result = photoUpdate([A, B], gallery());
    assert.deepEqual(result.images, [A, B]);
    assert.equal(result.photoCount, 2);
  });
});

describe('photoKey', () => {
  it('strips the query string and the fragment', () => {
    assert.equal(photoKey(`${A}?v=2`), A);
    assert.equal(photoKey(`${A}#top`), A);
    assert.equal(photoKey(`${A}?v=2#top`), A);
    assert.equal(photoKey(A), A);
  });
});

describe('dedupe', () => {
  it('keeps the first spelling of each photo', () => {
    assert.deepEqual(dedupe([A, `${A}?v=2`, B]), [A, B]);
  });

  it('drops empty entries', () => {
    assert.deepEqual(dedupe(['', A, '']), [A]);
  });
});
