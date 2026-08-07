import { createHash } from 'node:crypto';
import { prisma } from './db.js';
import { logger } from './logger.js';

const log = logger('dedupe');

/**
 * Groups ads for the same physical flat.
 *
 * ## The problem this does not already solve
 *
 * `persistListings` de-duplicates by `(source, external_id)` and by `source_url`.
 * That catches the same ad seen twice. It cannot catch the case that actually
 * annoys people: **one apartment, listed by two agencies, on three portals, at
 * three different prices.** Those are genuinely different ads with different ids,
 * and no amount of key-matching will merge them.
 *
 * So the feed shows the same flat four times, you rate it four times, and it
 * counts four times in the ranking.
 *
 * ## How they are matched
 *
 * Coordinates, size and layout — the three things two agencies cannot disagree
 * about:
 *
 *   - within ~60 m of each other (a building, not a block)
 *   - same bedroom count
 *   - floor area within 5%
 *
 * Price is deliberately **not** part of the match. Two agencies quoting different
 * numbers for the same flat is the whole point of finding them; requiring
 * agreement would filter out exactly the cases worth seeing.
 *
 * ## Why it is conservative, and stays conservative
 *
 * A false merge is much worse than a missed one. Merging two different flats
 * hides one of them permanently and attaches your notes to the wrong home. So:
 * listings with no coordinates are never clustered (a shared `null` is not
 * evidence), the area tolerance is tight, and the grid is small enough that
 * neighbouring buildings do not collide. A missed duplicate is a mild annoyance
 * that the user can see and reason about; a false merge is invisible.
 */

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const DEDUPE = {
  enabled: (process.env.DEDUPE_ENABLED ?? 'true').toLowerCase() !== 'false',
  /** Metres. A building's footprint, not a street. */
  radiusM: Math.max(10, int(process.env.DEDUPE_RADIUS_M, 60)),
  /** Floor-area tolerance, as a fraction. */
  areaTolerance: Math.max(0.01, int(process.env.DEDUPE_AREA_PCT, 5) / 100),
  /** Listings examined per run. */
  maxPerRun: Math.max(0, int(process.env.DEDUPE_MAX_PER_RUN, 5000)),
};

/** Metres per degree of latitude. Close enough everywhere. */
const M_PER_DEG_LAT = 111_320;

/**
 * Great-circle distance, small-angle approximation.
 *
 * Haversine would be more correct and is pointless at this scale: over 60 m the
 * error of treating the Earth as locally flat is millimetres, and this runs once
 * per candidate pair.
 */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (aLat - bLat) * M_PER_DEG_LAT;
  const dLng = (aLng - bLng) * M_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

type Candidate = {
  id: string;
  latitude: number;
  longitude: number;
  sqm: number;
  bedrooms: number;
  listingType: string;
  citySlug: string;
};

/**
 * A coarse grid cell, so candidates are compared against their neighbours rather
 * than against everything.
 *
 * Without it this is O(n²) — 8.000 listings is 32 million comparisons per run.
 * The cell is sized at the match radius, and each listing is checked against its
 * own cell and the eight around it, so a pair straddling a boundary is not missed.
 */
function cellOf(lat: number, lng: number): [number, number] {
  const size = DEDUPE.radiusM / M_PER_DEG_LAT;
  return [Math.floor(lat / size), Math.floor(lng / size)];
}

function sameFlat(a: Candidate, b: Candidate): boolean {
  if (a.listingType !== b.listingType) return false;
  if (a.citySlug !== b.citySlug) return false;
  if (a.bedrooms !== b.bedrooms) return false;

  // A listing with no stated area cannot be matched on area, and matching on
  // location alone would merge every flat in a building.
  if (a.sqm <= 0 || b.sqm <= 0) return false;
  const larger = Math.max(a.sqm, b.sqm);
  if (Math.abs(a.sqm - b.sqm) / larger > DEDUPE.areaTolerance) return false;

  return metresBetween(a.latitude, a.longitude, b.latitude, b.longitude) <= DEDUPE.radiusM;
}

/**
 * Assigns cluster keys.
 *
 * Union-find over the candidate set, then one key per group derived from its
 * smallest member id — stable across runs, so a cluster does not get a new key
 * (and the UI a new grouping) every night for no reason.
 */
export async function clusterDuplicates(): Promise<{ clustered: number; groups: number }> {
  if (!DEDUPE.enabled || DEDUPE.maxPerRun === 0) return { clustered: 0, groups: 0 };

  const rows = await prisma.property.findMany({
    where: {
      active: true,
      // No coordinates, no clustering. A shared `null` is not evidence of
      // anything, and guessing here is how two different flats get merged.
      latitude: { not: null },
      longitude: { not: null },
      sqm: { gt: 0 },
    },
    orderBy: { createdAt: 'desc' },
    take: DEDUPE.maxPerRun,
    select: {
      id: true,
      latitude: true,
      longitude: true,
      sqm: true,
      bedrooms: true,
      listingType: true,
      citySlug: true,
      clusterKey: true,
    },
  });

  if (rows.length < 2) return { clustered: 0, groups: 0 };

  const candidates: Candidate[] = rows.map((row) => ({
    id: row.id,
    latitude: row.latitude as number,
    longitude: row.longitude as number,
    sqm: row.sqm,
    bedrooms: row.bedrooms,
    listingType: row.listingType,
    citySlug: row.citySlug,
  }));

  // --- Spatial index --------------------------------------------------------
  const grid = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const [x, y] = cellOf(candidate.latitude, candidate.longitude);
    const key = `${x}:${y}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index);
    else grid.set(key, [index]);
  });

  // --- Union-find -----------------------------------------------------------
  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    // Path compression, so repeated lookups in a large cluster stay cheap.
    let walk = index;
    while (parent[walk] !== walk) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  };

  candidates.forEach((candidate, index) => {
    const [x, y] = cellOf(candidate.latitude, candidate.longitude);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of grid.get(`${x + dx}:${y + dy}`) ?? []) {
          // `other > index` compares each pair once and skips self-comparison.
          if (other > index && sameFlat(candidate, candidates[other])) union(index, other);
        }
      }
    }
  });

  // --- Assign keys ----------------------------------------------------------
  const groups = new Map<number, string[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(candidate.id);
    else groups.set(root, [candidate.id]);
  });

  let clustered = 0;
  let realGroups = 0;

  for (const ids of groups.values()) {
    // A group of one is not a duplicate. Its key is cleared rather than set, so a
    // listing whose twin has since been de-listed stops being marked as one.
    const key =
      ids.length > 1
        ? createHash('sha256').update([...ids].sort()[0]).digest('hex').slice(0, 32)
        : null;

    if (key) {
      realGroups += 1;
      clustered += ids.length;
    }

    const current = rows.filter((row) => ids.includes(row.id));
    const stale = current.filter((row) => row.clusterKey !== key).map((row) => row.id);
    if (stale.length === 0) continue;

    await prisma.property.updateMany({ where: { id: { in: stale } }, data: { clusterKey: key } });
  }

  if (realGroups > 0) {
    log.info(`duplicates: ${clustered} listing(s) in ${realGroups} group(s) of the same flat`);
  }
  return { clustered, groups: realGroups };
}
