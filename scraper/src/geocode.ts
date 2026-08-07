import { config, env, envOptional } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';

const log = logger('geocode');

/**
 * Fills in coordinates for listings whose portal did not provide any.
 *
 * QuintoAndar and Chaves na Mão publish lat/lon; OLX and ImovelWeb do not, so
 * without this the map would show a partial picture and silently omit two
 * sources. Addresses are resolved through Nominatim (the OpenStreetMap
 * geocoder), which is the natural companion to an OSM-tiled map.
 *
 * ## Why this is off by default
 *
 * Nominatim is donated infrastructure and its usage policy is explicit: at most
 * one request per second, a real User-Agent identifying the application, no bulk
 * geocoding, and cache your results. A scraper that quietly resolved 500
 * addresses on every run would be abusing a free service. So:
 *
 *  - `GEOCODE_ENABLED` must be turned on deliberately;
 *  - requests are spaced by at least a second (GEOCODE_DELAY_MS);
 *  - each run resolves at most GEOCODE_MAX_PER_RUN listings, so the backlog is
 *    worked through over days instead of in one burst;
 *  - `geocodedAt` is stamped whether or not a coordinate was found, so a
 *    failure is never retried in a loop;
 *  - identical addresses within a run are resolved once.
 *
 * Point GEOCODE_ENDPOINT at your own Nominatim container to lift all of this.
 */

const ENABLED = env('GEOCODE_ENABLED', 'false').toLowerCase() === 'true';
const ENDPOINT = env('GEOCODE_ENDPOINT', 'https://nominatim.openstreetmap.org/search');
const MAX_PER_RUN = Math.max(0, Number(env('GEOCODE_MAX_PER_RUN', '25')));
/** Nominatim's policy floor is 1s; the default leaves a little headroom. */
const DELAY_MS = Math.max(1000, Number(env('GEOCODE_DELAY_MS', '1100')));

/**
 * Nominatim asks for a contact address in the User-Agent so they can reach the
 * operator of a misbehaving client. Falls back to something identifying rather
 * than pretending to be a browser — this is the one place where honesty about
 * being a robot is the whole point.
 */
function userAgent(): string {
  const contact = envOptional('GEOCODE_CONTACT');
  return contact ? `FindHome/1.0 (${contact})` : 'FindHome/1.0 (self-hosted; set GEOCODE_CONTACT)';
}

type FetchResponse = { ok: boolean; status: number; text(): Promise<string> };
const httpFetch = (
  globalThis as unknown as {
    fetch: (url: string, init?: { headers?: Record<string, string>; signal?: unknown }) => Promise<FetchResponse>;
  }
).fetch;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Coords = { latitude: number; longitude: number };

/**
 * Three outcomes, not two — and the difference matters.
 *
 * `miss` means the geocoder answered and does not know this address: stamp it and
 * never ask again. `error` means we never got an answer (rate limit, blocked IP,
 * timeout): stamping it would permanently discard a listing because of a
 * transient problem, so the row is left untouched and the run gives up early
 * rather than hammering a service that is already refusing us.
 */
type LookupResult = { kind: 'hit'; coords: Coords } | { kind: 'miss' } | { kind: 'error'; detail: string };

async function lookup(query: string): Promise<LookupResult> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    // Brazil only: "Rua das Flores" exists on four continents.
    countrycodes: 'br',
    addressdetails: '0',
  });

  try {
    const response = await httpFetch(`${ENDPOINT}?${params}`, {
      headers: { 'user-agent': userAgent(), accept: 'application/json', 'accept-language': 'pt-BR' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return { kind: 'error', detail: `HTTP ${response.status}` };

    const results = JSON.parse(await response.text()) as Array<{ lat?: string; lon?: string }>;
    const hit = results[0];
    if (!hit?.lat || !hit?.lon) return { kind: 'miss' };

    const latitude = Number.parseFloat(hit.lat);
    const longitude = Number.parseFloat(hit.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { kind: 'miss' };

    return { kind: 'hit', coords: { latitude, longitude } };
  } catch (err) {
    return { kind: 'error', detail: (err as Error).message };
  }
}

/**
 * The address string to resolve.
 *
 * Street first, then neighborhood, city, state — Nominatim scores a full
 * hierarchy far better than a bare street name, and the neighborhood is what
 * saves a listing whose street number is missing from landing in the city
 * centre.
 */
function queryFor(listing: {
  address: string;
  neighborhood: string;
  city: string;
  state: string | null;
}): string | null {
  const parts = [listing.address, listing.neighborhood, listing.city, listing.state]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  // The address column falls back to the neighborhood when a portal gives no
  // street, which would geocode every listing in the area to one point. That is
  // still more useful than nothing, but a lone city name is not.
  if (parts.length < 2) return null;
  return [...new Set(parts)].join(', ');
}

/**
 * Resolves the commute destinations saved in preference profiles.
 *
 * Done first and separately from the listings: there are at most a handful of
 * them, they are the *reason* the commute pass exists, and a destination stuck
 * behind 500 listings in the queue would mean the feature silently does nothing
 * for days. Cleared and re-resolved whenever the address text changes (see the
 * preferences API).
 */
async function geocodeCommuteAddresses(): Promise<void> {
  const profiles = await prisma.preferenceProfile.findMany({
    where: { commuteAddress: { not: null }, commuteLat: null },
    select: { id: true, commuteAddress: true, city: true, state: true },
    take: 10,
  });

  for (const profile of profiles) {
    const address = (profile.commuteAddress ?? '').trim();
    if (!address) continue;

    // The city is appended when the address does not already name it, so "Av.
    // Paulista 1000" resolves in the right São Paulo rather than the first one
    // Nominatim finds.
    const query = [address, profile.city, profile.state].filter(Boolean).join(', ');
    const result = await lookup(query);
    await sleep(DELAY_MS);

    if (result.kind === 'hit') {
      await prisma.preferenceProfile.update({
        where: { id: profile.id },
        data: { commuteLat: result.coords.latitude, commuteLng: result.coords.longitude },
      });
      log.info(`commute destination resolved: ${query}`);
    } else if (result.kind === 'miss') {
      // Left unresolved rather than stamped. Unlike a listing, there is exactly
      // one of these and the user can see it did not work and retype it.
      log.warn(`commute destination not found: ${query}`);
    } else {
      log.warn(`commute destination lookup failed: ${result.detail}`);
      return;
    }
  }
}

export async function geocodePending(): Promise<void> {
  if (!ENABLED || MAX_PER_RUN === 0) return;

  await geocodeCommuteAddresses().catch((err) => log.error('commute geocoding failed', err));

  const pending = await prisma.property.findMany({
    where: { active: true, latitude: null, geocodedAt: null },
    // Newest first: those are the ones somebody is about to look at.
    orderBy: { createdAt: 'desc' },
    take: MAX_PER_RUN,
    select: { id: true, address: true, neighborhood: true, city: true, state: true },
  });

  if (pending.length === 0) return;

  const remaining = await prisma.property.count({
    where: { active: true, latitude: null, geocodedAt: null },
  });
  log.info(`resolving ${pending.length} of ${remaining} listing(s) without coordinates`);

  // Two listings in the same building share an address; resolve it once.
  const cache = new Map<string, LookupResult>();
  let found = 0;
  let misses = 0;
  let lastError: string | null = null;

  for (const listing of pending) {
    const query = queryFor(listing);

    if (!query) {
      // Stamped: there is nothing here to resolve, now or later.
      await prisma.property.update({ where: { id: listing.id }, data: { geocodedAt: new Date() } });
      continue;
    }

    let result = cache.get(query);
    if (result === undefined) {
      result = await lookup(query);
      cache.set(query, result);
      await sleep(DELAY_MS);
    }

    if (result.kind === 'error') {
      // Do NOT stamp. The service refused us; the address may well be fine, and
      // discarding the listing over a rate limit would be permanent. Stop here —
      // a geocoder that just said no is not going to say yes nine calls later.
      lastError = result.detail;
      break;
    }

    await prisma.property.update({
      where: { id: listing.id },
      data: { geocodedAt: new Date(), ...(result.kind === 'hit' ? result.coords : {}) },
    });

    if (result.kind === 'hit') found += 1;
    else misses += 1;
  }

  if (lastError) {
    log.warn(
      `geocoding stopped after ${found} hit(s): the service answered ${lastError}. ` +
        'Nothing was marked as tried, so these are retried next run. A 403 usually means the ' +
        'IP is blocked — Nominatim refuses most datacenter ranges; set GEOCODE_ENDPOINT to your own instance.',
    );
    return;
  }

  log.info(
    `geocoded ${found} hit(s), ${misses} not found (${cache.size} unique address(es) looked up)`,
  );
  if (remaining > pending.length) {
    const runsLeft = Math.ceil((remaining - pending.length) / MAX_PER_RUN);
    log.info(`${remaining - pending.length} still pending — about ${runsLeft} more run(s) at this rate`);
  }
}

/** Exposed so the doctor can report why the map might look empty. */
export const GEOCODE_STATUS = {
  enabled: ENABLED,
  endpoint: ENDPOINT,
  maxPerRun: MAX_PER_RUN,
  delayMs: DELAY_MS,
  contact: envOptional('GEOCODE_CONTACT') ?? null,
  timezone: config.timezone,
};
