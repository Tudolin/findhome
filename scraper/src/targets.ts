import { prisma } from './db.js';
import { config } from './config.js';
import { dedupeBySlug, displayName, locationSlug, toUf } from './locations.js';
import type { SearchTarget } from './types.js';

/**
 * The engine scrapes what people actually asked for: every PreferenceProfile
 * in the database (solo and party) becomes a search target. Profiles that
 * overlap are merged so two users hunting the same city do not double the
 * request volume.
 *
 * Every location that comes out of here is canonical: `citySlug` and
 * `neighborhoodSlugs` are `locationSlug()` values and `state` is a two-letter
 * UF. Profiles saved before the state field existed fall back to
 * SCRAPE_DEFAULT_STATE, which is the only place a default is applied — the
 * parsers themselves never guess a state.
 */
export async function buildSearchTargets(): Promise<SearchTarget[]> {
  const profiles = await prisma.preferenceProfile.findMany();

  if (profiles.length === 0) {
    const city = displayName(config.defaultCity);
    return [
      {
        city,
        citySlug: locationSlug(city),
        state: toUf(config.defaultState),
        neighborhoods: [],
        neighborhoodSlugs: [],
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
    const city = displayName(profile.city);
    const citySlug = locationSlug(city);
    if (!citySlug) continue;

    // The profile's own state wins; the env default only covers profiles saved
    // before the field existed.
    const state = toUf(profile.state) ?? toUf(config.defaultState);
    const neighborhoods = dedupeBySlug(profile.neighborhoods);

    // Two cities can share a name across states, so the state belongs in the key.
    const key = `${citySlug}|${state ?? '-'}|${profile.listingType}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        city,
        citySlug,
        state,
        neighborhoods,
        neighborhoodSlugs: neighborhoods.map(locationSlug),
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
    // An empty neighborhood list means "the whole city", which makes any
    // per-neighborhood narrowing from the other profile pointless.
    if (existing.neighborhoodSlugs.length === 0 || neighborhoods.length === 0) {
      existing.neighborhoods = [];
      existing.neighborhoodSlugs = [];
    } else {
      existing.neighborhoods = dedupeBySlug([...existing.neighborhoods, ...neighborhoods]);
      existing.neighborhoodSlugs = existing.neighborhoods.map(locationSlug);
    }

    existing.minPrice =
      existing.minPrice === null || profile.minPrice === null ? null : Math.min(existing.minPrice, profile.minPrice);
    existing.maxPrice =
      existing.maxPrice === null || profile.maxPrice === null ? null : Math.max(existing.maxPrice, profile.maxPrice);
    existing.minBedrooms = Math.min(existing.minBedrooms, profile.minBedrooms);
    existing.minSqm = Math.min(existing.minSqm, profile.minSqm);
  }

  return [...merged.values()];
}

/** One-line description of a target, for run logs. */
export function describeTarget(target: SearchTarget): string {
  const place = [target.city, target.state].filter(Boolean).join('/');
  const hoods = target.neighborhoods.length ? ` [${target.neighborhoods.join(', ')}]` : '';
  return `${place}${hoods}`;
}
