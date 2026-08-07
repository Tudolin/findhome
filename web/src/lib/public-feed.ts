import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { locationSlug } from './locations';

/**
 * The listings an anonymous visitor can see.
 *
 * ## Deliberately not `getFeed`
 *
 * `getFeed` takes a `Workspace` and threads it through `scopeFilter` into every
 * include — interactions, comments, pins, notes. Calling it with a fabricated
 * workspace to serve the public page would be one mistake away from leaking a
 * household's private notes to the internet, and the mistake would be invisible.
 *
 * So this is a separate function with a separate query that **selects only
 * columns that are already public on the portal**. There is no user, no
 * workspace, and nothing scoped anywhere in it. That is the property worth
 * protecting, and the way to protect it is to make the leak impossible to write
 * rather than careful not to.
 *
 * ## What the gate is and is not
 *
 * `FREE_LIMIT` is a product decision, not a security boundary: everything here is
 * public information republished from portals that show it to anyone. The point
 * of the limit is that saving, comparing, rating and sharing are what the app is
 * *for*, and those need somewhere to save to.
 */

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Listings shown before the sign-up gate. */
export const FREE_LIMIT = int(process.env.PUBLIC_FEED_LIMIT, 20);
/** Blurred teasers rendered under the gate, purely to show there is more. */
export const TEASER_COUNT = 3;

export type PublicFilters = {
  citySlug?: string;
  neighborhoodSlug?: string;
  listingType?: 'RENT' | 'SALE';
  maxPrice?: number;
  minBedrooms?: number;
};

/** Exactly the columns a public card renders. Nothing scoped, by construction. */
const PUBLIC_SELECT = {
  id: true,
  title: true,
  neighborhood: true,
  city: true,
  state: true,
  source: true,
  sourceUrl: true,
  listingType: true,
  rentPrice: true,
  condoFee: true,
  taxFee: true,
  totalPrice: true,
  bedrooms: true,
  bathrooms: true,
  parkingSpots: true,
  sqm: true,
  images: true,
  amenities: true,
  petFriendly: true,
  createdAt: true,
  photos: { where: { path: { not: null } }, select: { remoteUrl: true, path: true } },
} satisfies Prisma.PropertySelect;

export type PublicListing = Prisma.PropertyGetPayload<{ select: typeof PUBLIC_SELECT }>;

/**
 * The detail page gets two more columns than a card.
 *
 * Declared as its own select rather than bolted onto the query with a cast: a
 * cast would let the type claim fields the query does not fetch, which is exactly
 * the class of mistake this module's column discipline exists to prevent.
 *
 * Still nothing scoped — `description` and `address` are printed on the portal's
 * own page.
 */
const PUBLIC_DETAIL_SELECT = {
  ...PUBLIC_SELECT,
  description: true,
  address: true,
} satisfies Prisma.PropertySelect;

export type PublicListingDetail = Prisma.PropertyGetPayload<{ select: typeof PUBLIC_DETAIL_SELECT }>;

function publicWhere(filters: PublicFilters): Prisma.PropertyWhereInput {
  const where: Prisma.PropertyWhereInput = {
    // Only live listings. Showing a stranger an ad that has already closed is a
    // worse first impression than showing them fewer.
    active: true,
    goneAt: null,
    listingType: filters.listingType ?? 'RENT',
  };

  if (filters.citySlug) where.citySlug = filters.citySlug;
  if (filters.neighborhoodSlug) where.neighborhoodSlug = filters.neighborhoodSlug;
  if (filters.maxPrice) where.totalPrice = { lte: filters.maxPrice };
  if (filters.minBedrooms) where.bedrooms = { gte: filters.minBedrooms };

  return where;
}

export type PublicFeed = {
  listings: PublicListing[];
  /** Rendered blurred under the gate. Empty when there is nothing more. */
  teasers: PublicListing[];
  /** Everything matching, including what is behind the gate. */
  total: number;
  /** How many the gate is holding back. */
  locked: number;
  limit: number;
};

/**
 * A small in-process cache for the public queries.
 *
 * The public page is `force-dynamic` — it reads the session cookie to bounce
 * signed-in visitors — so Next cannot cache the *page*. Without something here,
 * every anonymous hit is three database round trips, and a page anyone on the
 * internet can request that many times is a load problem waiting for a slow news
 * day.
 *
 * A Map with a TTL rather than `unstable_cache`: the data is a few kilobytes,
 * there is one web process (see the note in rate-limit.ts about the same
 * trade-off), and 60 seconds of staleness on a feed that updates twice a day is
 * not staleness at all. The eviction is crude on purpose — a public page has a
 * bounded set of useful filter combinations, and the cap stops a query-string
 * fuzzer from turning this into a memory leak.
 */
const CACHE_TTL_MS = Math.max(0, Number(process.env.PUBLIC_FEED_CACHE_MS ?? 60_000));
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (CACHE_TTL_MS === 0) return load();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;

  const value = await load();

  // Cheapest possible eviction: past the cap, drop the oldest insertion. Map
  // preserves insertion order, so the first key is the oldest.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function getPublicFeed(filters: PublicFilters): Promise<PublicFeed> {
  return cached(`feed:${JSON.stringify(filters)}`, () => loadPublicFeed(filters));
}

async function loadPublicFeed(filters: PublicFilters): Promise<PublicFeed> {
  const where = publicWhere(filters);

  const [rows, total] = await Promise.all([
    prisma.property.findMany({
      where,
      // Newest first: a stranger landing here should see what is on the market
      // today, which is also the answer that makes the app look alive.
      orderBy: { createdAt: 'desc' },
      take: FREE_LIMIT + TEASER_COUNT,
      select: PUBLIC_SELECT,
    }),
    prisma.property.count({ where }),
  ]);

  return {
    listings: rows.slice(0, FREE_LIMIT),
    teasers: rows.slice(FREE_LIMIT),
    total,
    locked: Math.max(0, total - FREE_LIMIT),
    limit: FREE_LIMIT,
  };
}

/**
 * One listing, for the public detail page.
 *
 * `active: true` and nothing else — a closed ad has `active: false`, so this also
 * 404s the ones that have come down rather than showing a stranger something they
 * cannot go and see.
 */
export async function getPublicListing(id: string): Promise<PublicListingDetail | null> {
  return prisma.property.findFirst({ where: { id, active: true }, select: PUBLIC_DETAIL_SELECT });
}

export type PublicFacets = {
  cities: Array<{ slug: string; name: string; count: number }>;
  neighborhoods: Array<{ slug: string; name: string; count: number }>;
  defaultCitySlug: string;
};

/**
 * Filter options for the public page.
 *
 * There is no preference profile to scope by — an anonymous visitor has not told
 * us anything — so the default city is simply the one with the most listings.
 * That is the honest answer to "show me something useful before I have said what
 * I want", and it degrades gracefully on a fresh install with one city.
 */
export async function getPublicFacets(citySlug?: string): Promise<PublicFacets> {
  return cached(`facets:${citySlug ?? ''}`, () => loadPublicFacets(citySlug));
}

async function loadPublicFacets(citySlug?: string): Promise<PublicFacets> {
  const base: Prisma.PropertyWhereInput = { active: true, goneAt: null };

  const cityRows = await prisma.property.groupBy({
    by: ['citySlug', 'city'],
    where: base,
    _count: { citySlug: true },
    orderBy: { _count: { citySlug: 'desc' } },
    take: 40,
  });

  const seenCity = new Set<string>();
  const cities: PublicFacets['cities'] = [];
  for (const row of cityRows) {
    if (!row.citySlug || seenCity.has(row.citySlug)) continue;
    seenCity.add(row.citySlug);
    cities.push({ slug: row.citySlug, name: row.city, count: row._count.citySlug });
  }

  const defaultCitySlug = citySlug || cities[0]?.slug || '';

  const hoodRows = defaultCitySlug
    ? await prisma.property.groupBy({
        by: ['neighborhoodSlug', 'neighborhood'],
        where: { ...base, citySlug: defaultCitySlug },
        _count: { neighborhoodSlug: true },
        orderBy: { _count: { neighborhoodSlug: 'desc' } },
        take: 60,
      })
    : [];

  const seenHood = new Set<string>();
  const neighborhoods: PublicFacets['neighborhoods'] = [];
  for (const row of hoodRows) {
    if (!row.neighborhoodSlug || seenHood.has(row.neighborhoodSlug)) continue;
    seenHood.add(row.neighborhoodSlug);
    neighborhoods.push({
      slug: row.neighborhoodSlug,
      name: row.neighborhood,
      count: row._count.neighborhoodSlug,
    });
  }
  neighborhoods.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return { cities, neighborhoods, defaultCitySlug };
}

/** Parses the public page's query string. Deliberately a small vocabulary. */
export function parsePublicFilters(
  sp: Record<string, string | string[] | undefined>,
): PublicFilters & { citySlug?: string } {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const positive = (value: string | string[] | undefined) => {
    const parsed = Number(one(value));
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
  };

  return {
    // Slugged rather than trusted: the value lands in a `where` clause, and
    // `locationSlug` also makes "Sao Paulo" and "são paulo" the same filter.
    citySlug: one(sp.city) ? locationSlug(one(sp.city)) : undefined,
    neighborhoodSlug: one(sp.bairro) ? locationSlug(one(sp.bairro)) : undefined,
    listingType: one(sp.tipo) === 'venda' ? 'SALE' : 'RENT',
    maxPrice: positive(sp.ate),
    minBedrooms: positive(sp.quartos),
  };
}
