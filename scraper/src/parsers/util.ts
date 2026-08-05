/** Helpers shared by the portal parsers. */

import { locationSlug } from '../locations.js';
import type { RawListing, SearchTarget } from '../types.js';

/** "São Paulo" -> "sao-paulo". Re-exported from the canonical location module. */
export const slugify = locationSlug;

/**
 * Portals return money as numbers, numeric strings, or formatted strings
 * ("R$ 3.200", "3.200,00"). Normalise everything to whole BRL.
 */
export function toMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string') return 0;

  const cleaned = value.replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;

  // pt-BR: '.' groups thousands, ',' is the decimal separator.
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/\./g, '');

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export function toInt(value: unknown, fallback = 0): number {
  if (Array.isArray(value)) return toInt(value[0], fallback);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const match = value.match(/\d+/);
    if (match) return Number.parseInt(match[0], 10);
  }
  return fallback;
}

export function first<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

/** Trims, collapses whitespace and caps length so titles stay sane. */
export function clean(value: unknown, max = 300): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Same as `clean`, but accepts numbers.
 *
 * Listing ids are strings on one portal and JSON numbers on the next —
 * QuintoAndar returns `"id": 894855254` and OLX returns `"listId": 1234567`.
 * Passing those through `clean` yields "" (it only accepts strings), the parser
 * then treats the listing as having no id, and every single listing is silently
 * dropped. Always use this for an external id.
 */
export function idText(value: unknown, max = 80): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value)).slice(0, max);
  if (typeof value === 'bigint') return value.toString().slice(0, max);
  return clean(value, max);
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Very loose pet-policy detection from free text. Returns null (unknown)
 * rather than false when nothing matches — a wrong `false` would hide
 * perfectly good listings from anyone filtering on pets.
 */
export function detectPetPolicy(text: string): boolean | null {
  const haystack = text.toLowerCase();
  if (/n[aã]o\s+aceita\s+(pet|animai)/.test(haystack)) return false;
  if (/(aceita\s+pet|pet\s*friendly|permitido\s+animais|aceita\s+animais)/.test(haystack)) return true;
  return null;
}

/**
 * The filters every parser applies to its own results, in one place.
 *
 * Two reasons this is done here rather than with query parameters:
 *
 *  - Neighborhood. The portals key neighborhoods by internal location ids that
 *    would each cost an extra lookup request, so it has always been filtered
 *    client-side. Matching on slugs (not raw strings) is what makes
 *    "Vila Mariana" and "vila mariana" the same filter.
 *  - Bedrooms and area. ZAP's `bedrooms` and QuintoAndar's equivalent are
 *    EXACT-match parameters, not minimums: asking for `bedrooms=2` throws away
 *    every 3-bedroom flat. Sending them was silently narrowing every search, so
 *    the minimum is enforced here instead.
 *
 * Price is deliberately not filtered here: the portals' price parameters
 * already narrow the request, and the app applies each profile's own
 * rent-vs-all-in ceiling at query time. Re-filtering on one interpretation
 * would throw away rows the other interpretation wants.
 */
export function applyTargetFilters(listings: RawListing[], target: SearchTarget): RawListing[] {
  const wanted = new Set(target.neighborhoodSlugs);

  return listings.filter((listing) => {
    // City guard. Every one of these portals pads its results with nearby or
    // promoted listings from other cities — a São Paulo search on OLX comes back
    // with Santos on the first page, and QuintoAndar's flexible search does the
    // same. Without this the feed fills up with places nobody searched for.
    if (target.citySlug && locationSlug(listing.city) !== target.citySlug) return false;

    if (wanted.size > 0 && !wanted.has(locationSlug(listing.neighborhood))) return false;
    if (target.minBedrooms > 0 && (listing.bedrooms ?? 0) < target.minBedrooms) return false;
    if (target.minSqm > 0 && (listing.sqm ?? 0) < target.minSqm) return false;
    return true;
  });
}

/**
 * Depth-first search for the first array of objects in which every element has
 * all of `keys`.
 *
 * The hydration payloads these portals embed get reshaped on every redesign
 * (`props.pageProps.ads` becomes `props.pageProps.listingProps.adList` becomes
 * something else). Looking for the shape of a listing instead of its path
 * survives that, which is the difference between a parser that needs a patch
 * and one that keeps working.
 */
export function findRecordArray(root: unknown, keys: string[], maxDepth = 8): Record<string, unknown>[] | null {
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): Record<string, unknown>[] | null => {
    if (depth > maxDepth || node === null || typeof node !== 'object') return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      const records = node.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
      if (records.length === node.length && records.length > 0 && keys.every((key) => key in records[0])) {
        return records;
      }
      for (const item of node) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = walk(value, depth + 1);
      if (found) return found;
    }
    return null;
  };

  return walk(root, 0);
}
