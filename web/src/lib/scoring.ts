import type { InteractionStatus } from '@prisma/client';

/**
 * Party Ranking Engine.
 *
 * Turns the individual ratings/statuses that party members leave on a property
 * into a single 0-100 "match score" the Co-Op board can sort by.
 *
 * The score deliberately rewards *agreement*, not just a high average: a
 * property both partners rated 4 outranks one that a single partner rated 5.
 */

export type ScoreInput = {
  userId: string;
  rating: number | null;
  status: InteractionStatus;
  pros: string[];
  cons: string[];
};

export type PartyScore = {
  score: number; // 0-100
  avgRating: number | null; // 1-5, null when nobody rated
  ratedCount: number;
  memberCount: number;
  coverage: number; // 0-1, share of members who rated
  consensus: number; // 0-1, 1 = identical ratings
  spread: number; // max rating - min rating
  conflict: boolean; // members disagree by >= 3 stars
  vetoed: boolean; // at least one member rejected it
  bestStatus: InteractionStatus;
  sharedPros: string[]; // mentioned by every member who left pros
  sharedCons: string[];
  allPros: Array<{ label: string; count: number }>;
  allCons: Array<{ label: string; count: number }>;
};

const STATUS_WEIGHT: Record<InteractionStatus, number> = {
  REJECTED: 0,
  DISCOVERED: 0.2,
  INTERESTED: 0.5,
  FAVORITE: 0.7,
  VISIT_SCHEDULED: 0.85,
  APPLIED: 1,
};

const STATUS_RANK: InteractionStatus[] = [
  'REJECTED',
  'DISCOVERED',
  'INTERESTED',
  'FAVORITE',
  'VISIT_SCHEDULED',
  'APPLIED',
];

const WEIGHTS = { rating: 0.55, coverage: 0.15, consensus: 0.15, status: 0.15 };
/** Multiplier applied when any member has rejected the property. */
const VETO_MULTIPLIER = 0.35;

function tally(lists: string[][]): Array<{ label: string; count: number }> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const list of lists) {
    // De-duplicate within one member's list so nobody can inflate a tag.
    for (const label of new Set(list.map((l) => l.trim()).filter(Boolean))) {
      const key = label.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { label, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function scoreProperty(interactions: ScoreInput[], memberCount: number): PartyScore {
  const members = Math.max(memberCount, 1);
  const ratings = interactions.map((i) => i.rating).filter((r): r is number => typeof r === 'number');

  const ratedCount = ratings.length;
  const avgRating = ratedCount ? ratings.reduce((a, b) => a + b, 0) / ratedCount : null;
  const spread = ratedCount > 1 ? Math.max(...ratings) - Math.min(...ratings) : 0;

  // With a single rater there is nothing to agree on yet — 0.5 keeps it from
  // being rewarded or punished for a consensus that does not exist.
  const consensus = ratedCount > 1 ? 1 - spread / 4 : ratedCount === 1 ? 0.5 : 0;
  const coverage = Math.min(ratedCount / members, 1);

  // Seeded from the first interaction rather than DISCOVERED: REJECTED ranks
  // *below* DISCOVERED, so a seed of DISCOVERED would report a rejected-only
  // property as merely undiscovered and it would vanish from the board.
  const bestStatus: InteractionStatus = interactions.length
    ? interactions.reduce<InteractionStatus>(
        (best, i) => (STATUS_RANK.indexOf(i.status) > STATUS_RANK.indexOf(best) ? i.status : best),
        interactions[0].status,
      )
    : 'DISCOVERED';

  const vetoed = interactions.some((i) => i.status === 'REJECTED');

  const raw =
    WEIGHTS.rating * ((avgRating ?? 0) / 5) +
    WEIGHTS.coverage * coverage +
    WEIGHTS.consensus * consensus +
    WEIGHTS.status * STATUS_WEIGHT[bestStatus];

  const score = Math.round(raw * 100 * (vetoed ? VETO_MULTIPLIER : 1));

  const withPros = interactions.filter((i) => i.pros.length > 0);
  const withCons = interactions.filter((i) => i.cons.length > 0);
  const allPros = tally(interactions.map((i) => i.pros));
  const allCons = tally(interactions.map((i) => i.cons));

  return {
    score,
    avgRating: avgRating === null ? null : Math.round(avgRating * 10) / 10,
    ratedCount,
    memberCount: members,
    coverage,
    consensus,
    spread,
    conflict: spread >= 3,
    vetoed,
    bestStatus,
    sharedPros: withPros.length > 1 ? allPros.filter((p) => p.count === withPros.length).map((p) => p.label) : [],
    sharedCons: withCons.length > 1 ? allCons.filter((c) => c.count === withCons.length).map((c) => c.label) : [],
    allPros,
    allCons,
  };
}
