import type { Prisma, PreferenceProfile } from '@prisma/client';

/**
 * Translates a PreferenceProfile into a Prisma `where` clause for the
 * discovery feed.
 *
 * The one subtlety is `includeCondoInMaxPrice`: when enabled the budget ceiling
 * is checked against `total_price` (rent + condo + taxes), which is what people
 * actually pay each month. When disabled it is checked against bare rent.
 */
export function preferenceWhere(pref: PreferenceProfile | null): Prisma.PropertyWhereInput {
  if (!pref) return { active: true };

  const price: Prisma.IntFilter = {};
  if (pref.minPrice != null) price.gte = pref.minPrice;
  if (pref.maxPrice != null) price.lte = pref.maxPrice;
  const hasPriceFilter = pref.minPrice != null || pref.maxPrice != null;

  const where: Prisma.PropertyWhereInput = {
    active: true,
    listingType: pref.listingType,
    ...(pref.city ? { city: { equals: pref.city, mode: 'insensitive' } } : {}),
    ...(pref.neighborhoods.length ? { neighborhood: { in: pref.neighborhoods, mode: 'insensitive' } } : {}),
    bedrooms: { gte: pref.minBedrooms },
    bathrooms: { gte: pref.minBathrooms },
    parkingSpots: { gte: pref.minParkingSpots },
    sqm: { gte: pref.minSqm },
  };

  if (hasPriceFilter) {
    if (pref.includeCondoInMaxPrice) where.totalPrice = price;
    else where.rentPrice = price;
  }

  // Only filter on pets when the user asked for pet-friendly. Listings with an
  // unknown policy (null) are kept — excluding them hides too much.
  if (pref.petFriendly) where.petFriendly = { not: false };

  if (pref.amenities.length) where.amenities = { hasEvery: pref.amenities };

  return where;
}

/** Human-readable summary of the active filter, shown above the feed. */
export function describePreferences(pref: PreferenceProfile | null): string {
  if (!pref) return 'No preferences set yet — showing every listing.';
  const parts: string[] = [];
  parts.push(pref.neighborhoods.length ? `${pref.neighborhoods.join(', ')} · ${pref.city}` : pref.city);
  if (pref.maxPrice != null) {
    parts.push(
      `up to R$ ${pref.maxPrice.toLocaleString('pt-BR')} ${pref.includeCondoInMaxPrice ? 'all-in' : 'rent only'}`,
    );
  }
  if (pref.minBedrooms) parts.push(`${pref.minBedrooms}+ bed`);
  if (pref.minParkingSpots) parts.push(`${pref.minParkingSpots}+ parking`);
  if (pref.minSqm) parts.push(`${pref.minSqm}+ m²`);
  if (pref.petFriendly) parts.push('pet friendly');
  return parts.join(' · ');
}
