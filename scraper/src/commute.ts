import { env, envOptional } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';

const log = logger('commute');

/**
 * "How long to get to work?" — the filter that actually decides where people
 * live, and the one no portal offers.
 *
 * Runs like the geocoder: bounded per run, stamped so nothing is retried
 * forever, never allowed to fail the scrape.
 *
 * ## Providers
 *
 *   osrm   A self-hosted OSRM (`docker run osrm/osrm-backend`) or any
 *          compatible endpoint. Free, unlimited, private, and the right answer if
 *          you are going to use this seriously.
 *   ors    OpenRouteService. A free key covers ~2.000 requests/day, which is
 *          plenty for a household and needs no infrastructure.
 *   none   Off (the default).
 *
 * **The public OSRM demo server is deliberately not a default.** It is donated
 * infrastructure with an explicit no-heavy-use policy, and pointing a scraper at
 * it would be the same mistake the geocoder's comments warn about for Nominatim.
 *
 * ## Straight-line pre-filter
 *
 * Before any request, listings further away in a straight line than the maximum
 * commute could possibly allow are answered locally. At 80 km/h a 40-minute drive
 * cannot exceed ~53 km of road, and road distance is never *shorter* than the
 * crow-flies distance — so anything beyond that is a certain miss. On a city-wide
 * catalogue that removes most of the queue for free.
 */

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const COMMUTE = {
  provider: env('COMMUTE_PROVIDER', 'none').toLowerCase(),
  /** OSRM base, e.g. http://osrm:5000 */
  endpoint: envOptional('COMMUTE_ENDPOINT'),
  /** OpenRouteService API key. */
  apiKey: envOptional('COMMUTE_API_KEY'),
  maxPerRun: Math.max(0, int(process.env.COMMUTE_MAX_PER_RUN, 200)),
  delayMs: Math.max(0, int(process.env.COMMUTE_DELAY_MS, 250)),
  timeoutMs: Math.max(2000, int(process.env.COMMUTE_TIMEOUT_MS, 12_000)),
};

/** Fastest plausible average, used only by the pre-filter. Generous on purpose. */
const KMH_CEILING = 80;

type FetchResponse = { ok: boolean; status: number; text(): Promise<string> };
const httpFetch = (
  globalThis as unknown as {
    fetch: (url: string, init?: Record<string, unknown>) => Promise<FetchResponse>;
  }
).fetch;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Metres, small-angle approximation — same rationale as in dedupe.ts. */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (aLat - bLat) * 111_320;
  const dLng = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

const OSRM_PROFILE: Record<string, string> = {
  driving: 'driving',
  cycling: 'cycling',
  walking: 'walking',
};

const ORS_PROFILE: Record<string, string> = {
  driving: 'driving-car',
  cycling: 'cycling-regular',
  walking: 'foot-walking',
};

type Route = { minutes: number } | null;

/** One route lookup. Returns null for "no route" and throws for "provider is down". */
async function route(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: string,
): Promise<Route> {
  if (COMMUTE.provider === 'osrm') {
    const base = COMMUTE.endpoint;
    if (!base) throw new Error('COMMUTE_PROVIDER=osrm needs COMMUTE_ENDPOINT');

    const profile = OSRM_PROFILE[mode] ?? 'driving';
    // OSRM takes lon,lat — the opposite order to almost everything else, and a
    // silent source of "every route is 8.000 km" when it is got wrong.
    const url =
      `${base.replace(/\/$/, '')}/route/v1/${profile}/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false`;

    const response = await httpFetch(url, { signal: AbortSignal.timeout(COMMUTE.timeoutMs) });
    if (!response.ok) throw new Error(`OSRM answered ${response.status}`);

    const body = JSON.parse(await response.text()) as { routes?: Array<{ duration?: number }> };
    const seconds = body.routes?.[0]?.duration;
    return typeof seconds === 'number' ? { minutes: Math.round(seconds / 60) } : null;
  }

  if (COMMUTE.provider === 'ors') {
    if (!COMMUTE.apiKey) throw new Error('COMMUTE_PROVIDER=ors needs COMMUTE_API_KEY');

    const profile = ORS_PROFILE[mode] ?? 'driving-car';
    const response = await httpFetch(`https://api.openrouteservice.org/v2/directions/${profile}`, {
      method: 'POST',
      headers: { authorization: COMMUTE.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
      signal: AbortSignal.timeout(COMMUTE.timeoutMs),
    });
    if (!response.ok) throw new Error(`OpenRouteService answered ${response.status}`);

    const body = JSON.parse(await response.text()) as {
      routes?: Array<{ summary?: { duration?: number } }>;
    };
    const seconds = body.routes?.[0]?.summary?.duration;
    return typeof seconds === 'number' ? { minutes: Math.round(seconds / 60) } : null;
  }

  throw new Error(`Unknown COMMUTE_PROVIDER "${COMMUTE.provider}"`);
}

/**
 * Fills in commute times for listings that have none.
 *
 * One destination per workspace, taken from its preference profile. Profiles that
 * share a destination share the work — the column on Property is a single value,
 * which is the honest simplification for a household where everyone is measuring
 * against the same office.
 */
export async function computeCommutes(): Promise<void> {
  if (COMMUTE.provider === 'none' || COMMUTE.maxPerRun === 0) return;

  const profiles = await prisma.preferenceProfile.findMany({
    where: { commuteLat: { not: null }, commuteLng: { not: null } },
    select: { commuteLat: true, commuteLng: true, commuteMode: true, citySlug: true },
    take: 5,
  });

  if (profiles.length === 0) return;

  // One destination wins. Profiles disagreeing about where "work" is would need a
  // per-workspace column; until somebody actually has two offices, the first
  // configured destination is the one measured against — and the app says so.
  const destination = profiles[0];
  const to = { lat: destination.commuteLat as number, lng: destination.commuteLng as number };
  const mode = destination.commuteMode || 'driving';

  const pending = await prisma.property.findMany({
    where: {
      active: true,
      commuteCheckedAt: null,
      latitude: { not: null },
      longitude: { not: null },
      ...(destination.citySlug ? { citySlug: destination.citySlug } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: COMMUTE.maxPerRun,
    select: { id: true, latitude: true, longitude: true },
  });

  if (pending.length === 0) return;
  log.info(`routing ${pending.length} listing(s) to the commute address by ${mode}`);

  let routed = 0;
  let skipped = 0;
  let failed = 0;

  for (const property of pending) {
    const from = { lat: property.latitude as number, lng: property.longitude as number };

    /**
     * The free half of the answer.
     *
     * Road distance is never shorter than the straight line, so anything beyond
     * what the fastest plausible average could cover in the longest commute
     * anyone would filter on is a certain miss — no request needed.
     */
    const straightKm = metresBetween(from.lat, from.lng, to.lat, to.lng) / 1000;
    const ceilingMinutes = Math.round((straightKm / KMH_CEILING) * 60);
    if (ceilingMinutes > 180) {
      await prisma.property.update({
        where: { id: property.id },
        data: { commuteCheckedAt: new Date(), commuteMin: null },
      });
      skipped += 1;
      continue;
    }

    try {
      const result = await route(from, to, mode);
      await prisma.property.update({
        where: { id: property.id },
        data: { commuteCheckedAt: new Date(), commuteMin: result?.minutes ?? null },
      });
      if (result) routed += 1;
    } catch (err) {
      /**
       * Not stamped, and the pass stops.
       *
       * A provider that just refused is not going to accept the next 199 calls,
       * and stamping them would permanently mark real listings as unroutable
       * because of a transient outage — the same reasoning as the geocoder's
       * error path.
       */
      failed += 1;
      log.warn(`routing stopped after ${routed}: ${(err as Error).message}`);
      break;
    }

    if (COMMUTE.delayMs) await sleep(COMMUTE.delayMs);
  }

  log.info(`commute: ${routed} routed, ${skipped} too far to be worth asking, ${failed} error(s)`);
}

/** Exposed so the doctor can report the routing setup. */
export const COMMUTE_STATUS = { ...COMMUTE, apiKey: COMMUTE.apiKey ? '(set)' : null };
