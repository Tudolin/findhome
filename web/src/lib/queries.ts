import type { InteractionStatus, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { locationSlug } from './locations';
import { preferenceWhere } from './matching';
import { scoreProperty, type PartyScore } from './scoring';
import { scopeFilter, type Workspace } from './workspace';

export type FeedSort = 'newest' | 'price_asc' | 'price_desc' | 'score' | 'sqm_desc';

export type FeedOptions = {
  sort?: FeedSort;
  q?: string;
  status?: InteractionStatus | 'ALL' | 'UNREVIEWED';
  page?: number;
  perPage?: number;
  ignorePreferences?: boolean;
  // --- ad-hoc filters from the feed toolbar --------------------------------
  // These narrow *on top of* the saved preferences rather than replacing them,
  // so the toolbar is for "today I only want to look at X" without editing the
  // profile the scraper works from.
  source?: string;
  maxPrice?: number;
  minBedrooms?: number;
  minSqm?: number;
  neighborhood?: string;
  pinnedOnly?: boolean;
};

const ORDER: Record<FeedSort, Prisma.PropertyOrderByWithRelationInput> = {
  newest: { createdAt: 'desc' },
  price_asc: { totalPrice: 'asc' },
  price_desc: { totalPrice: 'desc' },
  sqm_desc: { sqm: 'desc' },
  // 'score' is computed in memory; this is only the tie-break fetch order.
  score: { createdAt: 'desc' },
};

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

/**
 * Options for the feed's filter dropdowns, built from what is actually in the
 * database for this workspace's city rather than from a hard-coded list — a
 * portal the user does not scrape should not appear, and neither should a
 * neighborhood with no listings.
 *
 * Grouped by the slug columns so one neighborhood the portals spell three ways
 * yields one option; the display name is whichever spelling is most common.
 */
export async function getFeedFacets(ws: Workspace) {
  const pref = await getPreferenceProfile(ws);
  const citySlug = pref ? pref.citySlug || locationSlug(pref.city) : '';
  const scope: Prisma.PropertyWhereInput = { active: true, ...(citySlug ? { citySlug } : {}) };

  const [sources, hoods] = await Promise.all([
    prisma.property.groupBy({ by: ['source'], where: scope, _count: { source: true } }),
    prisma.property.groupBy({
      by: ['neighborhoodSlug', 'neighborhood'],
      where: scope,
      _count: { neighborhoodSlug: true },
      orderBy: { _count: { neighborhoodSlug: 'desc' } },
      take: 120,
    }),
  ]);

  const seen = new Set<string>();
  const neighborhoods: Array<{ slug: string; name: string }> = [];
  for (const row of hoods) {
    if (!row.neighborhoodSlug || seen.has(row.neighborhoodSlug)) continue;
    seen.add(row.neighborhoodSlug);
    neighborhoods.push({ slug: row.neighborhoodSlug, name: row.neighborhood });
  }
  neighborhoods.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return {
    sources: sources.map((s) => s.source).sort(),
    neighborhoods,
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
    pins: rows.map((row) => ({
      ...row,
      // Non-null by construction: the query filters them out.
      latitude: row.latitude as number,
      longitude: row.longitude as number,
      pinned: pinnedIds.has(row.id),
    })),
  };
}

export async function getPreferenceProfile(ws: Workspace) {
  return prisma.preferenceProfile.findFirst({
    where: ws.kind === 'SOLO' ? { userId: ws.userId } : { partyId: ws.partyId! },
  });
}

/**
 * Discovery feed for the active workspace.
 *
 * Every property carries the interactions belonging to THIS workspace only
 * (see `scopeFilter`), plus the computed party score. Sorting by score happens
 * in memory because the score is derived, not stored — acceptable because a
 * home-server dataset is thousands of rows, not millions.
 */
export async function getFeed(ws: Workspace, opts: FeedOptions = {}) {
  const { sort = 'newest', q, status = 'ALL', page = 1, perPage = 24, ignorePreferences = false } = opts;

  const pref = ignorePreferences ? null : await getPreferenceProfile(ws);
  const where: Prisma.PropertyWhereInput = { ...preferenceWhere(pref) };

  if (q?.trim()) {
    const term = q.trim();
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { address: { contains: term, mode: 'insensitive' } },
      { neighborhood: { contains: term, mode: 'insensitive' } },
    ];
  }

  // Toolbar filters. Each narrows further; `preferenceWhere` may already have set
  // some of these, and the tighter of the two always wins because Prisma merges
  // the object keys — so the toolbar can only ever reduce the result set.
  if (opts.source) where.source = opts.source as Prisma.PropertyWhereInput['source'];
  if (opts.maxPrice) {
    const ceiling = pref?.includeCondoInMaxPrice === false ? 'rentPrice' : 'totalPrice';
    const existing = (where[ceiling] ?? {}) as Prisma.IntFilter;
    where[ceiling] = { ...existing, lte: Math.min(opts.maxPrice, existing.lte ?? opts.maxPrice) };
  }
  if (opts.minBedrooms) {
    const existing = (where.bedrooms ?? {}) as Prisma.IntFilter;
    where.bedrooms = { ...existing, gte: Math.max(opts.minBedrooms, existing.gte ?? 0) };
  }
  if (opts.minSqm) {
    const existing = (where.sqm ?? {}) as Prisma.IntFilter;
    where.sqm = { ...existing, gte: Math.max(opts.minSqm, existing.gte ?? 0) };
  }
  if (opts.neighborhood) where.neighborhoodSlug = opts.neighborhood;

  const scope = scopeFilter(ws);

  // `pinnedOnly` and a status filter both constrain `interactions`, so they are
  // composed rather than assigned — setting one after the other would silently
  // drop the first.
  const interactionFilters: Prisma.PropertyWhereInput[] = [];
  if (status === 'UNREVIEWED') {
    interactionFilters.push({ interactions: { none: { ...scope, status: { not: 'DISCOVERED' } } } });
  } else if (status !== 'ALL') {
    interactionFilters.push({ interactions: { some: { ...scope, status } } });
  }
  if (opts.pinnedOnly) {
    interactionFilters.push({ interactions: { some: { ...scope, pinned: true } } });
  }
  if (interactionFilters.length === 1) {
    Object.assign(where, interactionFilters[0]);
  } else if (interactionFilters.length > 1) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), ...interactionFilters];
  }

  // Score sorting needs the whole candidate set; other sorts can page in SQL.
  const sortInDb = sort !== 'score';
  // Ceiling on the in-memory sort so a huge database cannot blow up a request.
  const SCORE_SORT_LIMIT = 500;

  const include = {
    interactions: {
      where: ownRows(ws),
      include: { user: { select: { id: true, name: true } } },
    },
    _count: { select: { comments: { where: ownRows(ws) } } },
  } satisfies Prisma.PropertyInclude;

  /**
   * Pinned listings come first, whatever the sort.
   *
   * Prisma cannot order a property by a field on a to-many relation, so the
   * pinned ids are read first and the page is assembled from two queries. In
   * exchange the ordering is exact rather than approximated in memory, and the
   * common case (nothing pinned) costs one extra cheap indexed lookup — the
   * `(scope_key, pinned)` index exists for precisely this.
   */
  const pinnedRows = opts.pinnedOnly
    ? []
    : await prisma.propertyInteraction.findMany({
        where: { ...scope, pinned: true },
        select: { propertyId: true },
        // A sane ceiling: pins are a shortlist, not a second feed.
        take: 200,
      });
  const pinnedIds = [...new Set(pinnedRows.map((r) => r.propertyId))];

  const total = await prisma.property.count({ where });

  let rows: Prisma.PropertyGetPayload<{ include: typeof include }>[];

  if (pinnedIds.length === 0) {
    rows = await prisma.property.findMany({
      where,
      include,
      orderBy: ORDER[sort],
      skip: sortInDb ? (page - 1) * perPage : 0,
      take: sortInDb ? perPage : SCORE_SORT_LIMIT,
    });
  } else if (!sortInDb) {
    // Score sort already assembles the whole window in memory; just fetch it and
    // let the comparator below float the pins.
    rows = await prisma.property.findMany({ where, include, orderBy: ORDER[sort], take: SCORE_SORT_LIMIT });
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
            orderBy: ORDER[sort],
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
            orderBy: ORDER[sort],
            skip: Math.max(0, from - pinnedTotal),
            take: restTake,
          })
        : [];

    rows = [...pinnedSlice, ...restSlice];
  }

  const items = rows.map((property) => {
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

  if (!sortInDb) {
    const isPinned = new Set(pinnedIds);
    items.sort(
      (a, b) =>
        // Pins first, then score, then recency — same precedence as the SQL path.
        Number(isPinned.has(b.id)) - Number(isPinned.has(a.id)) ||
        b.partyScore.score - a.partyScore.score ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return {
      items: items.slice((page - 1) * perPage, page * perPage),
      total,
      page,
      perPage,
      preferences: pref,
    };
  }

  return { items, total, page, perPage, preferences: pref };
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
