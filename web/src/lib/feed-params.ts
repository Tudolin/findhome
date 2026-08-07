import type { FeedFilters, FeedSort } from './queries';

/**
 * One place that knows how the feed's filters are spelled in a URL.
 *
 * Both the Discovery feed and "Your homes" read the same vocabulary, and the
 * pagination links have to rebuild a query string that may contain *repeated*
 * parameters (`?source=OLX&source=ZAP`). The previous pagination helper did
 * `URLSearchParams.set(k, first(v))`, which silently collapsed every multi-value
 * filter to its first entry — so paging away from page 1 quietly widened the
 * search. Keeping parsing and serialisation in one module is what stops the two
 * from drifting apart again.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const FEED_SORTS = [
  'newest',
  'oldest',
  'price_asc',
  'price_desc',
  'sqm_desc',
  'sqm_asc',
  'ppsqm_asc',
  'score',
  'rating_desc',
  'reviewed_desc',
  'drop_desc',
  'sitting',
  'commute_asc',
] as const;

export const FEED_STATUSES = [
  'ALL',
  'UNREVIEWED',
  'REVIEWED',
  'INTERESTED',
  'FAVORITE',
  'VISIT_SCHEDULED',
  'APPLIED',
  'REJECTED',
] as const;

export type FeedStatusParam = (typeof FEED_STATUSES)[number];

/** Every parameter the feed understands, so "clear filters" knows what to drop. */
export const FILTER_KEYS = [
  'q',
  'status',
  'sort',
  'source',
  'neighborhood',
  'minPrice',
  'maxPrice',
  'bedrooms',
  'maxBedrooms',
  'bathrooms',
  'parking',
  'minSqm',
  'maxSqm',
  'amenity',
  'pets',
  'photos',
  'newDays',
  'minRating',
  'rated',
  'pinned',
  'listingType',
  'maxCommute',
  'droppedOnly',
  'ignorePreferences',
  'perPage',
] as const;

/** Keys that may legitimately appear more than once. */
export const MULTI_KEYS = new Set(['source', 'neighborhood', 'amenity']);

const list = (value: string | string[] | undefined): string[] => {
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  // A repeated checkbox arrives as an array; a hand-written or shared link may
  // use one comma-separated value. Accept both.
  return items
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
};

export const one = (value: string | string[] | undefined): string | undefined => {
  const [first] = list(value);
  return first;
};

/** Positive integer, or undefined. `0` reads as "no filter", which is what a blank select submits. */
const positive = (value: string | string[] | undefined): number | undefined => {
  const parsed = Number(one(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

const flag = (value: string | string[] | undefined): boolean => one(value) === 'true';

export function parsePage(sp: RawSearchParams): number {
  const parsed = Number(one(sp.page));
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

export function parsePerPage(sp: RawSearchParams, fallback = 24): number {
  const parsed = positive(sp.perPage);
  if (!parsed) return fallback;
  // Bounded: a shared link asking for 5000 per page would render the whole
  // catalogue into one server component.
  return Math.min(parsed, 96);
}

export function parseSort(sp: RawSearchParams, fallback: FeedSort): FeedSort {
  const value = one(sp.sort);
  return (FEED_SORTS as readonly string[]).includes(value ?? '') ? (value as FeedSort) : fallback;
}

export function parseStatus(sp: RawSearchParams, fallback: FeedStatusParam = 'ALL'): FeedStatusParam {
  const value = one(sp.status);
  return (FEED_STATUSES as readonly string[]).includes(value ?? '') ? (value as FeedStatusParam) : fallback;
}

/** Everything except sort/page, which the callers own. */
export function parseFilters(sp: RawSearchParams): FeedFilters {
  const petsValue = one(sp.pets);

  return {
    q: one(sp.q),
    status: parseStatus(sp),
    ignorePreferences: flag(sp.ignorePreferences),
    sources: list(sp.source),
    neighborhoods: list(sp.neighborhood),
    amenities: list(sp.amenity),
    minPrice: positive(sp.minPrice),
    maxPrice: positive(sp.maxPrice),
    minBedrooms: positive(sp.bedrooms),
    maxBedrooms: positive(sp.maxBedrooms),
    minBathrooms: positive(sp.bathrooms),
    minParking: positive(sp.parking),
    minSqm: positive(sp.minSqm),
    maxSqm: positive(sp.maxSqm),
    // Three states, not two: "any policy" must be distinguishable from
    // "explicitly not pet friendly", or the filter cannot be turned off.
    petFriendly: petsValue === 'yes' ? true : petsValue === 'no' ? false : undefined,
    withPhotos: flag(sp.photos),
    newWithinDays: positive(sp.newDays),
    minRating: positive(sp.minRating),
    ratedOnly: flag(sp.rated),
    pinnedOnly: flag(sp.pinned),
    listingType: one(sp.listingType) === 'SALE' ? 'SALE' : one(sp.listingType) === 'RENT' ? 'RENT' : undefined,
    maxCommuteMin: positive(sp.maxCommute),
    droppedOnly: flag(sp.droppedOnly),
  };
}

/**
 * Rebuilds a URL from the current parameters, applying `overrides`.
 *
 * Repeated parameters are preserved (see the note at the top). An override of
 * `null` removes the key entirely, which is how "go back to page 1" is expressed
 * without leaving `?page=` behind.
 */
export function hrefWith(
  base: string,
  sp: RawSearchParams,
  overrides: Record<string, string | number | null | undefined> = {},
): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(sp)) {
    if (key in overrides) continue;
    for (const item of list(value)) next.append(key, item);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined || value === '') continue;
    next.append(key, String(value));
  }

  const query = next.toString();
  return query ? `${base}?${query}` : base;
}

/** How many secondary filters are on, for the "More filters (3)" badge. */
export function countActiveFilters(sp: RawSearchParams, exclude: string[] = ['q', 'status', 'sort']): number {
  let total = 0;
  for (const key of FILTER_KEYS) {
    if (exclude.includes(key) || key === 'perPage') continue;
    total += MULTI_KEYS.has(key) ? list(sp[key]).length : list(sp[key]).length > 0 ? 1 : 0;
  }
  return total;
}
