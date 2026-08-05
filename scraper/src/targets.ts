import { prisma } from './db.js';
import { config } from './config.js';
import type { SearchTarget } from './types.js';

/**
 * The engine scrapes what people actually asked for: every PreferenceProfile
 * in the database (solo and party) becomes a search target. Profiles that
 * overlap are merged so two users hunting the same city do not double the
 * request volume.
 */
export async function buildSearchTargets(): Promise<SearchTarget[]> {
  const profiles = await prisma.preferenceProfile.findMany();

  if (profiles.length === 0) {
    return [
      {
        city: config.defaultCity,
        state: config.defaultState,
        neighborhoods: [],
        listingType: 'RENT',
        minPrice: null,
        maxPrice: null,
        minBedrooms: 0,
        minSqm: 0,
      },
    ];
  }

  const merged = new Map<string, SearchTarget>();

  for (const profile of profiles) {
    const key = `${profile.city.trim().toLowerCase()}|${profile.listingType}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        city: profile.city.trim(),
        state: config.defaultState,
        neighborhoods: [...profile.neighborhoods],
        listingType: profile.listingType,
        minPrice: profile.minPrice,
        maxPrice: profile.maxPrice,
        minBedrooms: profile.minBedrooms,
        minSqm: profile.minSqm,
      });
      continue;
    }

    // Widen the merged target so it is a superset of both profiles — filtering
    // back down to each user's exact criteria happens at query time in the app.
    existing.neighborhoods = [...new Set([...existing.neighborhoods, ...profile.neighborhoods])];
    existing.minPrice =
      existing.minPrice === null || profile.minPrice === null ? null : Math.min(existing.minPrice, profile.minPrice);
    existing.maxPrice =
      existing.maxPrice === null || profile.maxPrice === null ? null : Math.max(existing.maxPrice, profile.maxPrice);
    existing.minBedrooms = Math.min(existing.minBedrooms, profile.minBedrooms);
    existing.minSqm = Math.min(existing.minSqm, profile.minSqm);
  }

  // An empty neighborhood list means "the whole city", which makes any
  // per-neighborhood narrowing from another profile pointless.
  for (const target of merged.values()) {
    const cityWide = profiles.some(
      (p) => p.city.trim().toLowerCase() === target.city.toLowerCase() && p.neighborhoods.length === 0,
    );
    if (cityWide) target.neighborhoods = [];
  }

  return [...merged.values()];
}
