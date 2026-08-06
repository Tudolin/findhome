import type { PropertySource } from '@prisma/client';
import { prisma } from './db.js';
import { displayName, locationSlug, toUf } from './locations.js';
import { logger } from './logger.js';
import type { RawListing } from './types.js';

const log = logger('persist');

/** Matches the ceiling in photos.ts, so the two passes cannot disagree. */
const MAX_PHOTOS = 15;

export type PersistResult = {
  found: number;
  created: number;
  updated: number;
  skipped: number;
};

/**
 * Identity of a photo, ignoring the query string.
 *
 * The CDNs decorate the same file with per-request parameters
 * (`?isFirstImage=true`, cache-busting tokens, tracking ids), so a byte-for-byte
 * URL comparison reports "new photo" on every single run for a photo that has not
 * changed. That matters more than it sounds: `photoUpdate` clears
 * `photosFetchedAt` when it sees new photos, so URL churn alone would re-queue
 * those listings for the gallery backfill forever and consume the whole
 * PHOTOS_MAX_PER_RUN budget on listings that are already done — starving the ones
 * that actually need it.
 *
 * The full URL is what gets stored; only the comparison uses this key.
 */
function photoKey(url: string): string {
  return url.split('?')[0].split('#')[0];
}

/** De-duplicates by `photoKey`, keeping the first spelling of each photo. */
function dedupe(values: string[]): string[] {
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

/**
 * Decides what happens to a listing's photos when it is re-scraped.
 *
 * This is the one place that has to know about the gallery backfill (photos.ts),
 * and getting it wrong is silent and total: a plain `update: data` writes the
 * SEARCH RESULT's photos over whatever is stored, and on OLX, Chaves na Mão and
 * ImovelWeb that is exactly one cover photo. Every backfilled gallery would be
 * destroyed on the next run — and because `photosFetchedAt` is already stamped,
 * it would never be refetched. The carousels would quietly go back to one photo
 * a few hours after being filled.
 *
 * So:
 *   - a smaller incoming set never replaces a larger stored one;
 *   - an incoming set that is genuinely different (the portal re-shot the flat)
 *     wins, and clears the stamp so the backfill enriches the new set;
 *   - an unchanged set touches nothing, so the stamp survives.
 */
function photoUpdate(
  incoming: string[],
  existing: { images: string[]; photosFetchedAt: Date | null },
): { images?: string[]; photoCount?: number; photosFetchedAt?: Date | null } {
  const stored = existing.images;
  const storedKeys = new Set(stored.map(photoKey));

  // Nothing here we do not already have. This is the overwhelmingly common case:
  // the search result's single cover photo against a backfilled gallery. Keep the
  // gallery, and — importantly — keep the stamp.
  if (incoming.every((url) => storedKeys.has(photoKey(url)))) return {};

  // Genuinely new photos. Union rather than replace: the portal reordering its
  // carousel should not throw away photos the listing page gave us.
  const merged = dedupe([...incoming, ...stored]).slice(0, MAX_PHOTOS);
  return {
    images: merged,
    photoCount: merged.length,
    // Re-queued for the backfill: the listing really changed, so its page may now
    // have more than it did the last time we opened it.
    photosFetchedAt: null,
  };
}

function normalize(raw: RawListing) {
  const rentPrice = Math.max(0, Math.round(raw.rentPrice));
  const condoFee = Math.max(0, Math.round(raw.condoFee ?? 0));
  const taxFee = Math.max(0, Math.round(raw.taxFee ?? 0));

  // Portals spell the same place a dozen ways ("São Paulo", "Sao Paulo",
  // "SÃO PAULO"). The display columns keep whatever the portal sent, because
  // that is what reads correctly on a card; the slug columns are what the feed
  // filter compares against, so matching never depends on accents or case.
  const city = displayName(raw.city, 120);
  const neighborhood = displayName(raw.neighborhood, 120) || city;

  return {
    externalId: raw.externalId,
    sourceUrl: raw.sourceUrl,
    title: raw.title.slice(0, 300),
    description: raw.description?.slice(0, 4000) ?? null,
    address: raw.address.slice(0, 300),
    neighborhood,
    neighborhoodSlug: locationSlug(neighborhood),
    city,
    citySlug: locationSlug(city),
    // Normalised to a UF so "PR", "Paraná" and "parana" are one state.
    state: toUf(raw.state),
    rentPrice,
    condoFee,
    taxFee,
    // Stored rather than computed so the discovery feed can filter and sort on
    // the all-in price directly in SQL.
    totalPrice: rentPrice + condoFee + taxFee,
    bedrooms: Math.max(0, raw.bedrooms ?? 0),
    bathrooms: Math.max(0, raw.bathrooms ?? 0),
    parkingSpots: Math.max(0, raw.parkingSpots ?? 0),
    sqm: Math.max(0, raw.sqm ?? 0),
    images: dedupe(raw.images ?? []).slice(0, MAX_PHOTOS),
    amenities: (raw.amenities ?? []).slice(0, 30),
    petFriendly: raw.petFriendly ?? null,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    listingType: raw.listingType ?? ('RENT' as const),
    lastSeenAt: new Date(),
    active: true,
  };
}

/**
 * De-duplication happens on three levels:
 *   1. within the batch, by externalId (portals repeat listings across pages);
 *   2. within the batch, by sourceUrl (the same unit re-posted under two ids);
 *   3. in the database, via the unique (source, externalId) index — an upsert,
 *      so a listing seen again is refreshed instead of duplicated.
 */
export async function persistListings(source: PropertySource, listings: RawListing[]): Promise<PersistResult> {
  const result: PersistResult = { found: listings.length, created: 0, updated: 0, skipped: 0 };

  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const batch: RawListing[] = [];

  for (const listing of listings) {
    if (!listing.externalId || !listing.sourceUrl || !listing.city) {
      result.skipped += 1;
      continue;
    }
    if (seenIds.has(listing.externalId) || seenUrls.has(listing.sourceUrl)) {
      result.skipped += 1;
      continue;
    }
    seenIds.add(listing.externalId);
    seenUrls.add(listing.sourceUrl);
    batch.push(listing);
  }

  for (const listing of batch) {
    const data = normalize(listing);
    try {
      const existing = await prisma.property.findUnique({
        where: { source_externalId: { source, externalId: data.externalId } },
        select: { id: true, images: true, photosFetchedAt: true },
      });

      // `images` is removed from the update payload and re-added by photoUpdate,
      // which is the only thing allowed to decide the fate of a stored gallery.
      const { images, ...rest } = data;

      await prisma.property.upsert({
        where: { source_externalId: { source, externalId: data.externalId } },
        create: { ...data, source, photoCount: images.length },
        // createdAt is left alone so "new this week" stays meaningful.
        update: existing ? { ...rest, ...photoUpdate(images, existing) } : { ...data, photoCount: images.length },
      });

      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2002') {
        // sourceUrl collided with a row under a different external id —
        // the same unit re-listed. Refresh that row instead.
        await prisma.property
          .update({ where: { sourceUrl: data.sourceUrl }, data: { lastSeenAt: data.lastSeenAt, active: true } })
          .catch(() => undefined);
        result.skipped += 1;
      } else {
        log.warn(`failed to persist ${source} ${data.externalId}`, err);
        result.skipped += 1;
      }
    }
  }

  return result;
}

/** Flags listings nobody has seen in a while so they drop out of the feed. */
export async function deactivateStale(source: PropertySource, staleAfterDays: number): Promise<number> {
  if (staleAfterDays <= 0) return 0;
  const cutoff = new Date(Date.now() - staleAfterDays * 86_400_000);

  const { count } = await prisma.property.updateMany({
    where: { source, active: true, lastSeenAt: { lt: cutoff } },
    data: { active: false },
  });

  return count;
}
