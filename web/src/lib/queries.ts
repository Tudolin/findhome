import type { InteractionStatus, Prisma } from '@prisma/client';
import { prisma } from './prisma';
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

  const scope = scopeFilter(ws);

  if (status === 'UNREVIEWED') {
    where.interactions = { none: { ...scope, status: { not: 'DISCOVERED' } } };
  } else if (status !== 'ALL') {
    where.interactions = { some: { ...scope, status } };
  }

  // Score sorting needs the whole candidate set; other sorts can page in SQL.
  const sortInDb = sort !== 'score';
  // Ceiling on the in-memory sort so a huge database cannot blow up a request.
  const SCORE_SORT_LIMIT = 500;

  const [total, rows] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.findMany({
      where,
      include: {
        interactions: {
          where: ownRows(ws),
          include: { user: { select: { id: true, name: true } } },
        },
        _count: { select: { comments: { where: ownRows(ws) } } },
      },
      orderBy: ORDER[sort],
      skip: sortInDb ? (page - 1) * perPage : 0,
      take: sortInDb ? perPage : SCORE_SORT_LIMIT,
    }),
  ]);

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
    items.sort((a, b) => b.partyScore.score - a.partyScore.score || b.createdAt.getTime() - a.createdAt.getTime());
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
