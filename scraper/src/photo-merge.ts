/**
 * The rules for merging photo lists. Pure, and deliberately dependency-free.
 *
 * ## Why it is its own module
 *
 * Two reasons, and the second is the important one.
 *
 * It was three copies of `photoKey` — in persist.ts, photos.ts and (on the web
 * side) media.ts — with a comment on each saying "must stay in step with the
 * others". Three copies of a rule that must agree is a rule that will eventually
 * disagree; the scraper's two are now one.
 *
 * And `photoUpdate` is the highest-consequence pure function in the scraper,
 * which makes it the one most worth testing. Living in persist.ts, testing it
 * meant importing a Prisma client and, transitively, Playwright — for a function
 * that compares two string arrays. Here it imports nothing.
 */

const int = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Photos stored per listing. 0 = no limit, which is the default. */
export const MAX_PHOTOS = Math.max(0, int(process.env.PHOTOS_MAX_PER_LISTING, 0));

/** Applies MAX_PHOTOS, treating 0 as "no limit". */
export const capPhotos = <T>(values: T[]): T[] => (MAX_PHOTOS > 0 ? values.slice(0, MAX_PHOTOS) : values);

/**
 * Identity of a photo, ignoring the query string.
 *
 * These CDNs decorate one file with per-request parameters — `?isFirstImage=true`,
 * cache-busting tokens, tracking ids — so a byte-for-byte URL comparison reports
 * "new photo" on every single run for a photo that has not changed.
 *
 * That matters more than it sounds: `photoUpdate` clears `photosFetchedAt` when it
 * sees new photos, so URL churn alone would re-queue those listings for the
 * gallery backfill forever and spend the whole per-run budget on listings that are
 * already done — starving the ones that actually need it.
 *
 * The full URL is what gets stored; only the comparison uses this.
 */
export const photoKey = (url: string) => url.split('?')[0].split('#')[0];

/** De-duplicates by `photoKey`, keeping the first spelling of each photo. */
export function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of values) {
    if (!url) continue;
    const key = photoKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export type StoredPhotos = { images: string[]; photosFetchedAt: Date | null };
export type PhotoChange = {
  images?: string[];
  photoCount?: number;
  photosFetchedAt?: Date | null;
  photoAttempts?: number;
};

/**
 * Decides what happens to a listing's photos when it is re-scraped.
 *
 * Getting this wrong is silent and total. A plain `update: data` writes the
 * SEARCH RESULT's photos over whatever is stored, and on OLX, Chaves na Mão and
 * ImovelWeb that is exactly one cover photo. Every backfilled gallery would be
 * destroyed on the next run — and because `photosFetchedAt` is already stamped, it
 * would never be refetched. The carousels would quietly go back to one photo a few
 * hours after being filled, with nothing in any log to say why.
 *
 * So:
 *   - a set that is a subset of what is stored never replaces it;
 *   - genuinely new photos are unioned in, and clear the stamp so the backfill
 *     re-visits a listing that has actually changed;
 *   - an unchanged set touches nothing, so the stamp survives.
 */
export function photoUpdate(incoming: string[], existing: StoredPhotos): PhotoChange {
  const stored = existing.images;
  const storedKeys = new Set(stored.map(photoKey));

  // Nothing here we do not already have. This is the overwhelmingly common case:
  // the search result's single cover photo against a backfilled gallery. Keep the
  // gallery, and — importantly — keep the stamp.
  if (incoming.every((url) => storedKeys.has(photoKey(url)))) return {};

  // Union rather than replace: the portal reordering its carousel should not
  // throw away photos the listing page gave us.
  const merged = capPhotos(dedupe([...incoming, ...stored]));
  return {
    images: merged,
    photoCount: merged.length,
    // Re-queued for the backfill: the listing really changed, so its page may now
    // have more than it did the last time we opened it.
    photosFetchedAt: null,
    // And with a fresh attempt budget. A listing that has actually changed is not
    // the same listing that used up its retries — without this, an ad that had
    // already exhausted PHOTOS_MAX_ATTEMPTS would get exactly one look at its new
    // gallery and then be written off again.
    photoAttempts: 0,
  };
}
