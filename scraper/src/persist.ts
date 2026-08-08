import type { PropertySource } from '@prisma/client';
import { prisma } from './db.js';
import { displayName, locationSlug, toUf } from './locations.js';
import { logger } from './logger.js';
import { syncPhotoRows } from './media.js';
// The merge rules live in their own module: they are pure, they are the highest
// -consequence logic in the scraper, and testing them here would have meant
// importing a Prisma client and Playwright to compare two string arrays.
import { capPhotos, dedupe, photoUpdate } from './photo-merge.js';
import type { RawListing } from './types.js';

const log = logger('persist');

export type PersistResult = {
  found: number;
  created: number;
  updated: number;
  skipped: number;
};

function normalize(raw: RawListing) {
  const rentPrice = Math.max(0, Math.round(raw.rentPrice));
  const condoFee = Math.max(0, Math.round(raw.condoFee ?? 0));
  const taxFee = Math.max(0, Math.round(raw.taxFee ?? 0));
  const listingType = raw.listingType ?? 'RENT';

  /**
   * `total_price` is what the feed filters and sorts on, and it means a different
   * thing per listing type — which is the bug this replaces.
   *
   *   RENT   rent + condo + IPTU/12. One monthly figure: what leaves the account.
   *   SALE   the asking price, ALONE.
   *
   * Adding the monthly costs to a sale price is not a rounding error. A
   * R$ 650.000 flat with a R$ 900 condo fee was stored as R$ 650.900, so a
   * "up to R$ 650.000" search missed it — and the card showed R$ 650.900 "/mês".
   * The condo fee and IPTU are still stored, because you go on paying them after
   * buying and they belong on the detail screen; they are just not part of the
   * price you are searching by.
   */
  const totalPrice = listingType === 'SALE' ? rentPrice : rentPrice + condoFee + taxFee;

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
    // Stored rather than computed so the feed can filter and sort on it directly
    // in SQL. See the note above for why it is type-dependent.
    totalPrice,
    bedrooms: Math.max(0, raw.bedrooms ?? 0),
    bathrooms: Math.max(0, raw.bathrooms ?? 0),
    parkingSpots: Math.max(0, raw.parkingSpots ?? 0),
    sqm: Math.max(0, raw.sqm ?? 0),
    images: capPhotos(dedupe(raw.images ?? [])),
    amenities: (raw.amenities ?? []).slice(0, 30),
    petFriendly: raw.petFriendly ?? null,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    listingType,
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
        select: { id: true, images: true, photosFetchedAt: true, totalPrice: true },
      });

      // `images` is removed from the update payload and re-added by photoUpdate,
      // which is the only thing allowed to decide the fate of a stored gallery.
      // Computed once: calling it twice risks the row and the mirror index
      // disagreeing about which list won.
      const { images, ...rest } = data;
      const photoChange = existing ? photoUpdate(images, existing) : null;

      /**
       * The price change, captured before the upsert overwrites it.
       *
       * This was the bug the whole feature exists to fix: the scraper re-reads
       * every listing twice a day and upserts it, so each cut was silently
       * written over. The most useful signal in a rental market was being thrown
       * away on a schedule.
       */
      const priceMoved = existing !== null && existing.totalPrice !== data.totalPrice;

      const row = await prisma.property.upsert({
        where: { source_externalId: { source, externalId: data.externalId } },
        create: { ...data, source, photoCount: images.length },
        // createdAt is left alone so "new this week" stays meaningful.
        update: existing
          ? {
              ...rest,
              ...photoChange,
              // Seen again, so it is not gone after all. `normalize` already
              // sets `active: true`; clearing the stamp is what stops the app
              // from labelling a re-listed flat "no longer listed" forever.
              goneAt: null,
            }
          : { ...data, photoCount: images.length },
        select: { id: true },
      });

      // Keep the mirror index in step with the gallery. `photoChange.images` is
      // undefined when photoUpdate decided to keep what was stored, in which case
      // the index is already correct for `existing.images`.
      await syncPhotoRows(row.id, photoChange?.images ?? existing?.images ?? images).catch((err) =>
        log.warn(`could not sync the photo index for ${source} ${data.externalId}`, err),
      );

      /**
       * One row per change, never per sighting.
       *
       * A listing that sits at the same price for three months costs one row, not
       * 180. `delta` is stored rather than derived so "biggest drop this week" is
       * an indexed scan instead of a window function over the whole table.
       */
      if (priceMoved || !existing) {
        await prisma.propertyPriceEvent
          .create({
            data: {
              propertyId: row.id,
              rentPrice: data.rentPrice,
              condoFee: data.condoFee,
              totalPrice: data.totalPrice,
              delta: existing ? data.totalPrice - existing.totalPrice : 0,
            },
          })
          .catch(() => undefined);

        if (priceMoved) {
          const move = data.totalPrice - (existing?.totalPrice ?? 0);
          log.debug(`${data.externalId}: price ${move > 0 ? 'up' : 'down'} ${Math.abs(move)}`);
        }
      }

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
