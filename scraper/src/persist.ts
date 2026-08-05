import type { PropertySource } from '@prisma/client';
import { prisma } from './db.js';
import { displayName, locationSlug, toUf } from './locations.js';
import { logger } from './logger.js';
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
    images: (raw.images ?? []).slice(0, 15),
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
        select: { id: true },
      });

      await prisma.property.upsert({
        where: { source_externalId: { source, externalId: data.externalId } },
        create: { ...data, source },
        // createdAt is left alone so "new this week" stays meaningful.
        update: data,
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
