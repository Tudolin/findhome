import type { Prisma, PreferenceProfile } from '@prisma/client';
import { locationSlug, ufToStateName } from './locations';

/**
 * Translates a PreferenceProfile into a Prisma `where` clause for the
 * discovery feed.
 *
 * Locations are matched on the slug columns, never on the display spellings.
 * The old `{ city: { equals, mode: 'insensitive' } }` looked like it handled
 * this, but case-insensitivity does nothing about accents: a profile saved as
 * "Sao Paulo" matched no listing at all once the portal returned "São Paulo".
 * Comparing `citySlug` makes both of them `sao-paulo`.
 *
 * The other subtlety is `includeCondoInMaxPrice`: when enabled the budget
 * ceiling is checked against `total_price` (rent + condo + taxes), which is what
 * people actually pay each month. When disabled it is checked against bare rent.
 */
export function preferenceWhere(pref: PreferenceProfile | null): Prisma.PropertyWhereInput {
  if (!pref) return { active: true };

  const price: Prisma.IntFilter = {};
  if (pref.minPrice != null) price.gte = pref.minPrice;
  if (pref.maxPrice != null) price.lte = pref.maxPrice;
  const hasPriceFilter = pref.minPrice != null || pref.maxPrice != null;

  // Derived rather than read straight off the row, so a profile written before
  // the slug columns existed (or by a seed script) still filters correctly.
  const citySlug = pref.citySlug || locationSlug(pref.city);
  const neighborhoodSlugs = (
    pref.neighborhoodSlugs.length ? pref.neighborhoodSlugs : pref.neighborhoods.map(locationSlug)
  ).filter(Boolean);

  const where: Prisma.PropertyWhereInput = {
    active: true,
    listingType: pref.listingType,
    ...(citySlug ? { citySlug } : {}),
    ...(neighborhoodSlugs.length ? { neighborhoodSlug: { in: neighborhoodSlugs } } : {}),
    bedrooms: { gte: pref.minBedrooms },
    bathrooms: { gte: pref.minBathrooms },
    parkingSpots: { gte: pref.minParkingSpots },
    sqm: { gte: pref.minSqm },
  };

  // Same city name in two states is common in Brazil, so narrow by state when
  // the profile has one. Listings whose portal did not report a state are kept:
  // dropping them would hide real matches for a field nobody filled in.
  // Nested under AND because getFeed() owns the top-level OR for its search box.
  if (pref.state) {
    where.AND = [{ OR: [{ state: pref.state }, { state: null }] }];
  }

  if (hasPriceFilter) {
    // `includeCondoInMaxPrice` is a rent-only idea: it chooses between comparing
    // the budget against bare rent or against rent + condo + IPTU. A sale has no
    // "all-in" — `totalPrice` IS the asking price for a SALE row (see
    // normalize() in scraper/src/persist.ts) — so the flag is ignored rather
    // than honoured on a field where it would mean nothing.
    if (pref.listingType === 'SALE') where.totalPrice = price;
    else if (pref.includeCondoInMaxPrice) where.totalPrice = price;
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

  const forSale = pref.listingType === 'SALE';
  const place = [pref.city, pref.state].filter(Boolean).join('/');
  const parts: string[] = [pref.neighborhoods.length ? `${pref.neighborhoods.join(', ')} · ${place}` : place];

  parts.push(forSale ? 'for sale' : 'to rent');

  if (pref.maxPrice != null) {
    // No "all-in" / "rent only" qualifier on a sale: there is nothing to include,
    // and saying "R$ 800.000 all-in" reads as though the fees were folded in.
    const qualifier = forSale ? '' : ` ${pref.includeCondoInMaxPrice ? 'all-in' : 'rent only'}`;
    parts.push(`up to R$ ${pref.maxPrice.toLocaleString('pt-BR')}${qualifier}`);
  }
  if (pref.minBedrooms) parts.push(`${pref.minBedrooms}+ bed`);
  if (pref.minParkingSpots) parts.push(`${pref.minParkingSpots}+ parking`);
  if (pref.minSqm) parts.push(`${pref.minSqm}+ m²`);
  if (pref.petFriendly) parts.push('pet friendly');
  return parts.join(' · ');
}

/**
 * Warnings worth showing on the preferences screen. A profile with no state
 * still works, but two of the four portals need one to scope a search
 * correctly, so it is worth saying so rather than quietly returning less.
 */
export function preferenceWarnings(pref: PreferenceProfile | null): string[] {
  if (!pref) return [];
  const warnings: string[] = [];

  if (!pref.state) {
    warnings.push(
      'No state selected. ZAP and QuintoAndar scope their searches by state, so results will be broader and ' +
        'may include a same-named city elsewhere in Brazil.',
    );
  } else if (!ufToStateName(pref.state)) {
    warnings.push(`"${pref.state}" is not a Brazilian state code — pick one from the list.`);
  }

  return warnings;
}
