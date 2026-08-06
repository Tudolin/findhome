import type { InteractionStatus, Prisma, PropertySource } from '@prisma/client';
import { prisma } from './prisma';
import { locationSlug } from './locations';
import { preferenceWhere } from './matching';
import { scoreProperty, type PartyScore } from './scoring';
import { scopeFilter, type Workspace } from './workspace';

export type FeedSort =
  | 'newest'
  | 'oldest'
  | 'price_asc'
  | 'price_desc'
  | 'sqm_desc'
  | 'sqm_asc'
  /** Price per m² — the number that actually compares two flats. */
  | 'ppsqm_asc'
  | 'score'
  /** Your own star rating, highest first. Only meaningful on reviewed listings. */
  | 'rating_desc'
  /** Most recently reviewed by this workspace. */
  | 'reviewed_desc';

/**
 * Ad-hoc filters from a toolbar. Every one of these narrows *on top of* the saved
 * preferences rather than replacing them, so the toolbar answers "today I only
 * want to look at X" without editing the profile the scraper works from.
 *
 * `sources`, `neighborhoods` and `amenities` are lists because picking two
 * neighborhoods at once is the normal case when you are house-hunting — you
 * compare Batel against Água Verde, you do not look at one and then start over.
 */
export type FeedFilters = {
  q?: string;
  status?: InteractionStatus | 'ALL' | 'UNREVIEWED' | 'REVIEWED';
  ignorePreferences?: boolean;

  sources?: string[];
  neighborhoods?: string[];
  amenities?: string[];

  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  maxBedrooms?: number;
  minBathrooms?: number;
  minParking?: number;
  minSqm?: number;
  maxSqm?: number;

  /** true = pet-friendly or unknown; false = explicitly not pet-friendly. */
  petFriendly?: boolean;
  /** Drop listings whose portal gave us no photo at all. */
  withPhotos?: boolean;
  /** Only listings first seen in the last N days. */
  newWithinDays?: number;

  /** Your own rating floor, 1-5. Implies "reviewed by me". */
  minRating?: number;
  /** Only listings this workspace has rated. */
  ratedOnly?: boolean;
  pinnedOnly?: boolean;

  listingType?: 'RENT' | 'SALE';
};

export type FeedOptions = FeedFilters & {
  sort?: FeedSort;
  page?: number;
  perPage?: number;
  /** Float pinned listings to the top. Off on screens that sort by review data. */
  pinnedFirst?: boolean;
};

/** Sorts Postgres can do; everything else is assembled in memory. */
const SQL_ORDER: Partial<Record<FeedSort, Prisma.PropertyOrderByWithRelationInput>> = {
  newest: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
  price_asc: { totalPrice: 'asc' },
  price_desc: { totalPrice: 'desc' },
  sqm_desc: { sqm: 'desc' },
  sqm_asc: { sqm: 'asc' },
};

/**
 * Ceiling on the in-memory sort window.
 *
 * `score`, `ppsqm_asc`, `rating_desc` and `reviewed_desc` are all derived values
 * — the first two from columns Prisma cannot express an ORDER BY over, the last
 * two from a to-many relation — so they are ranked in the request. That means the
 * ranking only sees the first N rows, and `getFeed` reports how many pages are
 * actually reachable rather than letting the UI offer pages that resolve to an
 * empty grid. This was the pagination bug: `total` was the full count while the
 * window was 500, so "Page 34 of 84" rendered nothing.
 */
const MEMORY_SORT_WINDOW = 2000;

/** How many pinned listings can be floated to the top before it is a second feed. */
const PIN_CEILING = 200;

/**
 * Rows belonging to the active workspace.
 * In Solo Mode every user shares the literal scopeKey "solo", so the user id
 * has to be part of the filter or personal notes would leak between accounts.
 */
function ownRows(ws: Workspace) {
  return ws.kind === 'SOLO'
    ? { scopeKey: 'solo', userId: ws.userId }
    : { scopeKey: ws.scopeKey };
}

/**
 * Most recent run per source, for the dashboard freshness banner. Without this
 * the ScrapeRun table is invisible and a silently broken parser looks
 * identical to "no new listings this week".
 */
export async function getLastScrapeRuns() {
  const runs = await prisma.scrapeRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 30,
  });

  const latestPerSource = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latestPerSource.has(run.source)) latestPerSource.set(run.source, run);
  }
  return [...latestPerSource.values()];
}

/**
 * True while a run is in flight, so the dashboard's trigger button starts in the
 * right state on a fresh page load. Read from the ScrapeRun table rather than by
 * calling the scraper: this runs during render, and a page should not wait on
 * another container to paint.
 */
export async function isScrapeRunning(): Promise<boolean> {
  const running = await prisma.scrapeRun.findFirst({
    where: { status: 'RUNNING' },
    select: { id: true },
  });
  return running !== null;
}

export type FeedFacets = {
  sources: Array<{ value: string; count: number }>;
  neighborhoods: Array<{ slug: string; name: string; count: number }>;
  amenities: Array<{ value: string; count: number }>;
  /** Actual bounds in the data, so the price inputs can suggest a sane range. */
  priceRange: { min: number; max: number } | null;
  sqmRange: { min: number; max: number } | null;
  maxBedrooms: number;
};

/**
 * Options for the feed's filters, built from what is actually in the database
 * rather than from a hard-coded list — a portal the user does not scrape should
 * not appear, and neither should a neighborhood with no listings.
 *
 * Counts are included because on a multi-select they are the difference between
 * a usable control and a wall of names: "Batel (48)" tells you where to look.
 *
 * Grouped by the slug columns so one neighborhood the portals spell three ways
 * yields one option; the display name is whichever spelling is most common.
 *
 * `over` decides which set the options describe, and the two screens genuinely
 * need different answers:
 *
 *   'catalogue' — active listings in the profile's city. What Discovery searches.
 *   'reviewed'  — only what this workspace has acted on, and NOT city-scoped,
 *                 because "Your homes" ignores the saved profile. Scoping these
 *                 by the profile's city would offer a neighborhood filter with no
 *                 chip for a flat visible right there on the screen — which is
 *                 what happens the moment somebody edits their city.
 */
export async function getFeedFacets(
  ws: Workspace,
  over: 'catalogue' | 'reviewed' = 'catalogue',
): Promise<FeedFacets> {
  const pref = over === 'catalogue' ? await getPreferenceProfile(ws) : null;
  const citySlug = pref ? pref.citySlug || locationSlug(pref.city) : '';

  const scope: Prisma.PropertyWhereInput =
    over === 'reviewed'
      ? { interactions: { some: { ...scopeFilter(ws), status: { not: 'DISCOVERED' } } } }
      : { active: true, ...(citySlug ? { citySlug } : {}) };

  const [sources, hoods, bounds, amenityRows] = await Promise.all([
    prisma.property.groupBy({ by: ['source'], where: scope, _count: { source: true } }),
    prisma.property.groupBy({
      by: ['neighborhoodSlug', 'neighborhood'],
      where: scope,
      _count: { neighborhoodSlug: true },
      orderBy: { _count: { neighborhoodSlug: 'desc' } },
      take: 240,
    }),
    prisma.property.aggregate({
      where: scope,
      _min: { totalPrice: true, sqm: true },
      _max: { totalPrice: true, sqm: true, bedrooms: true },
    }),
    // Amenities are a String[] column, so there is no GROUP BY for them. The
    // tally is done in memory over a bounded sample: this only feeds a filter
    // list, and reading a few thousand short arrays is cheaper than a lateral
    // unnest for a home-server dataset.
    prisma.property.findMany({
      where: { ...scope, amenities: { isEmpty: false } },
      select: { amenities: true },
      orderBy: { createdAt: 'desc' },
      take: 4000,
    }),
  ]);

  const seen = new Set<string>();
  const neighborhoods: FeedFacets['neighborhoods'] = [];
  for (const row of hoods) {
    if (!row.neighborhoodSlug || seen.has(row.neighborhoodSlug)) continue;
    seen.add(row.neighborhoodSlug);
    neighborhoods.push({
      slug: row.neighborhoodSlug,
      name: row.neighborhood,
      count: row._count.neighborhoodSlug,
    });
  }
  neighborhoods.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const amenityCounts = new Map<string, { value: string; count: number }>();
  for (const row of amenityRows) {
    for (const amenity of new Set(row.amenities)) {
      const key = amenity.toLowerCase();
      const entry = amenityCounts.get(key);
      if (entry) entry.count += 1;
      else amenityCounts.set(key, { value: amenity, count: 1 });
    }
  }

  return {
    sources: sources
      .map((s) => ({ value: s.source as string, count: s._count.source }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    neighborhoods,
    amenities: [...amenityCounts.values()]
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'pt-BR'))
      .slice(0, 40),
    priceRange:
      bounds._min.totalPrice != null && bounds._max.totalPrice != null
        ? { min: bounds._min.totalPrice, max: bounds._max.totalPrice }
        : null,
    sqmRange:
      bounds._min.sqm != null && bounds._max.sqm != null
        ? { min: bounds._min.sqm, max: bounds._max.sqm }
        : null,
    maxBedrooms: bounds._max.bedrooms ?? 0,
  };
}

/**
 * Listings for the map: the same set the feed would show, minus the ones with no
 * coordinates.
 *
 * `withoutCoords` is returned rather than quietly dropped — a map that shows 40
 * of 200 listings while looking complete is worse than one that says so, and the
 * number is what tells the user whether turning the geocoder on is worth it.
 */
export async function getMapPins(ws: Workspace) {
  const pref = await getPreferenceProfile(ws);
  const where: Prisma.PropertyWhereInput = preferenceWhere(pref);

  const [rows, withoutCoords, pinnedRows] = await Promise.all([
    prisma.property.findMany({
      where: { ...where, latitude: { not: null }, longitude: { not: null } },
      orderBy: { totalPrice: 'asc' },
      // A ceiling: past a few thousand markers Leaflet needs clustering, and the
      // cheapest ones are the ones worth seeing first anyway.
      take: 1500,
      select: {
        id: true,
        title: true,
        neighborhood: true,
        city: true,
        totalPrice: true,
        bedrooms: true,
        sqm: true,
        source: true,
        latitude: true,
        longitude: true,
        // First photo only: the map shows a thumbnail per listing, and shipping
        // twelve URLs each would bloat the payload for nothing.
        images: true,
      },
    }),
    prisma.property.count({ where: { ...where, latitude: null } }),
    prisma.propertyInteraction.findMany({
      where: { ...scopeFilter(ws), pinned: true },
      select: { propertyId: true },
      take: 500,
    }),
  ]);

  const pinnedIds = new Set(pinnedRows.map((r) => r.propertyId));

  return {
    withoutCoords,
    pins: rows.map(({ images, ...row }) => ({
      ...row,
      // Non-null by construction: the query filters them out.
      latitude: row.latitude as number,
      longitude: row.longitude as number,
      image: images[0] ?? null,
      pinned: pinnedIds.has(row.id),
    })),
  };
}

export async function getPreferenceProfile(ws: Workspace) {
  return prisma.preferenceProfile.findFirst({
    where: ws.kind === 'SOLO' ? { userId: ws.userId } : { partyId: ws.partyId! },
  });
}

/** Numeric columns the toolbar may constrain. */
type NumericField = 'bedrooms' | 'bathrooms' | 'parkingSpots' | 'sqm' | 'totalPrice' | 'rentPrice';

/**
 * Narrows an existing Int filter without letting the caller widen it.
 *
 * The saved preferences may already have set a bound. Taking the tighter of the
 * two means the toolbar can only ever reduce the result set — a filter that could
 * widen past what the party agreed on would make the profile meaningless.
 */
function tighten(where: Prisma.PropertyWhereInput, field: NumericField, bound: 'gte' | 'lte', value: number) {
  const existing = (where[field] ?? {}) as Prisma.IntFilter;
  const current = existing[bound];
  const next: Prisma.IntFilter = { ...existing };
  if (bound === 'gte') next.gte = Math.max(value, current ?? 0);
  else next.lte = Math.min(value, current ?? value);
  where[field] = next;
}

/**
 * Translates the toolbar filters into a Prisma `where`.
 *
 * Split out of `getFeed` so "Your homes" can reuse the exact same filter
 * vocabulary — two screens that claim to filter the same way must not each own
 * their own half-implementation of it.
 */
function applyFilters(
  where: Prisma.PropertyWhereInput,
  pref: Awaited<ReturnType<typeof getPreferenceProfile>>,
  f: FeedFilters,
) {
  if (f.q?.trim()) {
    const term = f.q.trim();
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { address: { contains: term, mode: 'insensitive' } },
      { neighborhood: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
    ];
  }

  if (f.sources?.length) where.source = { in: f.sources as PropertySource[] };
  if (f.listingType) where.listingType = f.listingType;

  // Both bounds are checked against whichever price the profile treats as the
  // budget — all-in or bare rent — so the toolbar and the saved ceiling never
  // disagree about what "R$ 3.000" means.
  const priceField = pref?.includeCondoInMaxPrice === false ? 'rentPrice' : 'totalPrice';
  if (f.minPrice) tighten(where, priceField, 'gte', f.minPrice);
  if (f.maxPrice) tighten(where, priceField, 'lte', f.maxPrice);

  if (f.minBedrooms) tighten(where, 'bedrooms', 'gte', f.minBedrooms);
  if (f.maxBedrooms) tighten(where, 'bedrooms', 'lte', f.maxBedrooms);
  if (f.minBathrooms) tighten(where, 'bathrooms', 'gte', f.minBathrooms);
  if (f.minParking) tighten(where, 'parkingSpots', 'gte', f.minParking);
  if (f.minSqm) tighten(where, 'sqm', 'gte', f.minSqm);
  if (f.maxSqm) tighten(where, 'sqm', 'lte', f.maxSqm);

  if (f.neighborhoods?.length) {
    // Intersected with the profile's own neighborhood list rather than replacing
    // it, so the toolbar can only narrow. Picking a neighborhood the profile does
    // not include yields nothing, which is honest — the alternative is a filter
    // that silently widens the search past what the party agreed on.
    const existing = (where.neighborhoodSlug ?? null) as Prisma.StringFilter | null;
    const allowed = existing && Array.isArray(existing.in) ? (existing.in as string[]) : null;
    const picked = allowed ? f.neighborhoods.filter((n) => allowed.includes(n)) : f.neighborhoods;
    where.neighborhoodSlug = { in: picked };
  }

  if (f.amenities?.length) {
    const existing = (where.amenities ?? {}) as { hasEvery?: string[] };
    where.amenities = { hasEvery: [...new Set([...(existing.hasEvery ?? []), ...f.amenities])] };
  }

  // `not: false` keeps listings whose policy the portal never stated — excluding
  // them hides too much. Asking for `false` is the deliberate opposite.
  if (f.petFriendly === true) where.petFriendly = { not: false };
  else if (f.petFriendly === false) where.petFriendly = false;

  // `isEmpty: false` rather than a NOT wrapper: preferenceWhere owns no NOT
  // clause today, but merging into one would be the kind of quiet coupling that
  // breaks the first time it does.
  if (f.withPhotos) where.images = { isEmpty: false };

  if (f.newWithinDays) {
    where.createdAt = { gte: new Date(Date.now() - f.newWithinDays * 86_400_000) };
  }
}

/**
 * Interaction-scoped conditions, composed rather than assigned.
 *
 * `status`, `pinnedOnly`, `ratedOnly` and `minRating` all constrain the same
 * to-many relation; setting one after another would silently drop the earlier
 * ones, which is how "pinned + favorites" used to return every favorite.
 */
function interactionConditions(ws: Workspace, f: FeedFilters): Prisma.PropertyWhereInput[] {
  const scope = scopeFilter(ws);
  const conditions: Prisma.PropertyWhereInput[] = [];
  const status = f.status ?? 'ALL';

  if (status === 'UNREVIEWED') {
    conditions.push({ interactions: { none: { ...scope, status: { not: 'DISCOVERED' } } } });
  } else if (status === 'REVIEWED') {
    conditions.push({ interactions: { some: { ...scope, status: { not: 'DISCOVERED' } } } });
  } else if (status !== 'ALL') {
    conditions.push({ interactions: { some: { ...scope, status } } });
  }

  if (f.pinnedOnly) conditions.push({ interactions: { some: { ...scope, pinned: true } } });
  if (f.minRating) conditions.push({ interactions: { some: { ...scope, rating: { gte: f.minRating } } } });
  else if (f.ratedOnly) conditions.push({ interactions: { some: { ...scope, rating: { not: null } } } });

  return conditions;
}

export type FeedResult = {
  items: FeedItem[];
  /** Rows matching the filter, whether or not they are reachable by paging. */
  total: number;
  /** Pages the UI may actually offer. Equals ceil(total/perPage) unless capped. */
  pageCount: number;
  page: number;
  perPage: number;
  /** True when `total` exceeds the in-memory ranking window (see MEMORY_SORT_WINDOW). */
  truncated: boolean;
  preferences: Awaited<ReturnType<typeof getPreferenceProfile>>;
};

type PropertyRow = Prisma.PropertyGetPayload<{
  include: {
    interactions: { include: { user: { select: { id: true; name: true } } } };
    _count: { select: { comments: true } };
  };
}>;

export type FeedItem = PropertyRow & {
  partyScore: PartyScore;
  mine: PropertyRow['interactions'][number] | null;
  commentCount: number;
};

/**
 * Discovery feed for the active workspace.
 *
 * Every property carries the interactions belonging to THIS workspace only
 * (see `scopeFilter`), plus the computed party score.
 */
export async function getFeed(ws: Workspace, opts: FeedOptions = {}): Promise<FeedResult> {
  const { sort = 'newest', page: requestedPage = 1, perPage = 24, pinnedFirst = true } = opts;

  const pref = opts.ignorePreferences ? null : await getPreferenceProfile(ws);
  const where: Prisma.PropertyWhereInput = { ...preferenceWhere(pref) };

  applyFilters(where, pref, opts);

  const conditions = interactionConditions(ws, opts);
  if (conditions.length > 0) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), ...conditions];
  }

  const include = {
    interactions: {
      where: ownRows(ws),
      include: { user: { select: { id: true, name: true } } },
    },
    _count: { select: { comments: { where: ownRows(ws) } } },
  } satisfies Prisma.PropertyInclude;

  const sqlOrder = SQL_ORDER[sort];
  const rankInMemory = sqlOrder === undefined;

  /**
   * Pinned listings come first, whatever the sort.
   *
   * Prisma cannot order a property by a field on a to-many relation, so the
   * pinned ids are read first and the page is assembled from two queries. In
   * exchange the ordering is exact rather than approximated in memory, and the
   * common case (nothing pinned) costs one extra cheap indexed lookup — the
   * `(scope_key, pinned)` index exists for precisely this.
   */
  const wantPinsFirst = pinnedFirst && !opts.pinnedOnly;
  const pinnedRows = wantPinsFirst
    ? await prisma.propertyInteraction.findMany({
        where: { ...scopeFilter(ws), pinned: true },
        select: { propertyId: true },
        take: PIN_CEILING,
      })
    : [];
  const pinnedIds = [...new Set(pinnedRows.map((r) => r.propertyId))];

  const total = await prisma.property.count({ where });

  // Pages the UI is allowed to offer. For an in-memory ranking only the window is
  // reachable, and claiming otherwise is exactly what made "Next" dead-end on an
  // empty grid.
  const reachable = rankInMemory ? Math.min(total, MEMORY_SORT_WINDOW) : total;
  const pageCount = Math.max(1, Math.ceil(reachable / perPage));
  // Clamped, so a stale bookmark or a filter change that shrank the result set
  // lands on the last real page instead of rendering nothing.
  const page = Math.min(Math.max(1, requestedPage), pageCount);

  let rows: PropertyRow[];

  // Tested against `sqlOrder` rather than the `rankInMemory` alias so the two
  // branches below get a non-optional `orderBy` without a cast.
  if (sqlOrder === undefined) {
    // The whole window, ranked below and sliced to the page.
    rows = await prisma.property.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
      take: MEMORY_SORT_WINDOW,
    });
  } else if (pinnedIds.length === 0) {
    rows = await prisma.property.findMany({
      where,
      include,
      orderBy: sqlOrder,
      skip: (page - 1) * perPage,
      take: perPage,
    });
  } else {
    const pinnedWhere: Prisma.PropertyWhereInput = { AND: [where, { id: { in: pinnedIds } }] };
    const restWhere: Prisma.PropertyWhereInput = { AND: [where, { id: { notIn: pinnedIds } }] };

    // The feed is one list — [pins…, everything else…] — so the page window has
    // to be mapped across the boundary between the two queries.
    const pinnedTotal = await prisma.property.count({ where: pinnedWhere });
    const from = (page - 1) * perPage;

    const pinnedSlice =
      from < pinnedTotal
        ? await prisma.property.findMany({
            where: pinnedWhere,
            include,
            orderBy: sqlOrder,
            skip: from,
            take: perPage,
          })
        : [];

    const restTake = perPage - pinnedSlice.length;
    const restSlice =
      restTake > 0
        ? await prisma.property.findMany({
            where: restWhere,
            include,
            orderBy: sqlOrder,
            skip: Math.max(0, from - pinnedTotal),
            take: restTake,
          })
        : [];

    rows = [...pinnedSlice, ...restSlice];
  }

  const items: FeedItem[] = rows.map((property) => {
    const partyScore: PartyScore = scoreProperty(
      property.interactions.map((i) => ({
        userId: i.userId,
        rating: i.rating,
        status: i.status,
        pros: i.pros,
        cons: i.cons,
      })),
      ws.members.length,
    );
    const mine = property.interactions.find((i) => i.userId === ws.userId) ?? null;
    return { ...property, partyScore, mine, commentCount: property._count.comments };
  });

  if (rankInMemory) {
    const isPinned = new Set(pinnedIds);
    const rank = comparator(sort, ws);
    items.sort(
      (a, b) =>
        (wantPinsFirst ? Number(isPinned.has(b.id)) - Number(isPinned.has(a.id)) : 0) ||
        rank(a, b) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return {
      items: items.slice((page - 1) * perPage, page * perPage),
      total,
      pageCount,
      page,
      perPage,
      truncated: total > MEMORY_SORT_WINDOW,
      preferences: pref,
    };
  }

  return { items, total, pageCount, page, perPage, truncated: false, preferences: pref };
}

/** Comparators for the sorts Postgres cannot express. */
function comparator(sort: FeedSort, ws: Workspace): (a: FeedItem, b: FeedItem) => number {
  switch (sort) {
    case 'score':
      return (a, b) => b.partyScore.score - a.partyScore.score;

    case 'ppsqm_asc':
      // Listings with no area go last rather than first: a 0 m² row would
      // otherwise divide to Infinity or sort as free, and either way it buries
      // the listings the sort exists to surface.
      //
      // Compared explicitly instead of returning `a - b` on two Infinities,
      // which is NaN. A NaN comparator only *happens* to work here (NaN is
      // falsy, so the `||` chain falls through to the recency tie-break) and
      // Array#sort's behaviour with one is unspecified.
      return (a, b) => {
        const left = pricePerSqm(a);
        const right = pricePerSqm(b);
        if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
        if (!Number.isFinite(left)) return 1;
        if (!Number.isFinite(right)) return -1;
        return left - right;
      };

    case 'rating_desc':
      return (a, b) => (b.mine?.rating ?? -1) - (a.mine?.rating ?? -1);

    case 'reviewed_desc':
      return (a, b) => reviewedAt(b, ws) - reviewedAt(a, ws);

    default:
      return () => 0;
  }
}

export function pricePerSqm(item: { totalPrice: number; sqm: number }): number {
  return item.sqm > 0 ? item.totalPrice / item.sqm : Number.POSITIVE_INFINITY;
}

/** When this workspace last touched the listing, for "recently reviewed". */
function reviewedAt(item: FeedItem, ws: Workspace): number {
  const times = item.interactions
    .filter((i) => ws.kind === 'PARTY' || i.userId === ws.userId)
    .map((i) => i.updatedAt.getTime());
  return times.length ? Math.max(...times) : 0;
}

/**
 * Counts per status for this workspace, so "Your homes" can label its tabs
 * without loading each bucket. One grouped query rather than six counts.
 */
export async function getStatusCounts(ws: Workspace): Promise<Record<InteractionStatus, number> & { RATED: number }> {
  const scope = scopeFilter(ws);
  const [grouped, rated] = await Promise.all([
    prisma.propertyInteraction.groupBy({ by: ['status'], where: scope, _count: { status: true } }),
    prisma.propertyInteraction.count({ where: { ...scope, rating: { not: null } } }),
  ]);

  const counts = {
    DISCOVERED: 0,
    INTERESTED: 0,
    FAVORITE: 0,
    VISIT_SCHEDULED: 0,
    APPLIED: 0,
    REJECTED: 0,
    RATED: rated,
  };
  for (const row of grouped) counts[row.status] = row._count.status;
  return counts;
}

/**
 * Headline numbers for "Your homes".
 *
 * Aggregated in the database rather than derived from the page being rendered:
 * "average 4.2 stars" computed over the 24 rows that happen to be on screen is a
 * different number every time you page, which is worse than no number at all.
 */
export async function getReviewSummary(ws: Workspace) {
  const scope = scopeFilter(ws);

  const [ratings, reviewed, pinned, upcomingVisits, priced] = await Promise.all([
    prisma.propertyInteraction.aggregate({
      where: { ...scope, rating: { not: null } },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.propertyInteraction.count({ where: { ...scope, status: { not: 'DISCOVERED' } } }),
    prisma.propertyInteraction.count({ where: { ...scope, pinned: true } }),
    prisma.visit.count({ where: { ...scope, scheduledAt: { gte: new Date() } } }),
    prisma.property.aggregate({
      where: { interactions: { some: { ...scope, status: { not: 'DISCOVERED' } } } },
      _min: { totalPrice: true },
      _avg: { totalPrice: true },
    }),
  ]);

  return {
    reviewed,
    rated: ratings._count.rating,
    avgRating: ratings._avg.rating === null ? null : Math.round(ratings._avg.rating * 10) / 10,
    pinned,
    upcomingVisits,
    cheapest: priced._min.totalPrice,
    avgPrice: priced._avg.totalPrice === null ? null : Math.round(priced._avg.totalPrice),
  };
}

/** Kanban data: every property this workspace has acted on, grouped by status. */
export async function getBoard(ws: Workspace) {
  const rows = await prisma.property.findMany({
    where: {
      interactions: {
        some: { ...scopeFilter(ws), status: { not: 'DISCOVERED' } },
      },
    },
    include: {
      interactions: {
        where: ownRows(ws),
        include: { user: { select: { id: true, name: true } } },
      },
      _count: { select: { comments: { where: ownRows(ws) } } },
    },
  });

  const cards = rows.map((property) => {
    const partyScore = scoreProperty(
      property.interactions.map((i) => ({
        userId: i.userId,
        rating: i.rating,
        status: i.status,
        pros: i.pros,
        cons: i.cons,
      })),
      ws.members.length,
    );
    return {
      ...property,
      partyScore,
      mine: property.interactions.find((i) => i.userId === ws.userId) ?? null,
      commentCount: property._count.comments,
    };
  });

  cards.sort((a, b) => b.partyScore.score - a.partyScore.score);
  return cards;
}

export async function getPropertyDetail(ws: Workspace, propertyId: string) {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: {
      interactions: {
        where: ownRows(ws),
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        where: ownRows(ws),
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!property) return null;

  const partyScore = scoreProperty(
    property.interactions.map((i) => ({
      userId: i.userId,
      rating: i.rating,
      status: i.status,
      pros: i.pros,
      cons: i.cons,
    })),
    ws.members.length,
  );

  return {
    ...property,
    partyScore,
    mine: property.interactions.find((i) => i.userId === ws.userId) ?? null,
  };
}
