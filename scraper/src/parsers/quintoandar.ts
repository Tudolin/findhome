import { envOptional } from '../config.js';
import { describeFailure, requestJson } from '../http.js';
import { toUf } from '../locations.js';
import type { Parser, RawListing, ScrapeContext, SearchTarget } from '../types.js';
import {
  applyTargetFilters,
  clean,
  detectPetPolicy,
  findRecordArray,
  idText,
  toInt,
  toMoney,
  unique,
} from './util.js';

/**
 * QuintoAndar.
 *
 * The request shape below was captured from the site itself (open the search
 * page, watch the POST to apigw.prod.quintoandar.com.br) and then verified
 * against the live API, which matters because almost none of it is guessable:
 *
 *   - The path is /house-listing-search/v3/search/list. The older
 *     /cached/house-listing-search/v2/... path now answers 404 at the gateway,
 *     which is exactly the failure this project was seeing.
 *   - `slug` is a TOP-LEVEL field ("sao-paulo-sp-brasil"), not filters.citySlug.
 *   - `availability` and `occupancy` are UPPERCASE ("ANY"). Lowercase "any" is
 *     rejected with `400 Invalid parameter type`.
 *   - Paging is `pagination: { pageSize, offset }`, not a page number.
 *   - Bedrooms and area are nested ranges under `filters.houseSpecs`.
 *   - Unrecognised filter keys are SILENTLY IGNORED rather than rejected, so a
 *     wrong guess looks like it works while filtering nothing. Every filter here
 *     was confirmed to change the result count.
 *
 * Price is deliberately not filtered server-side: no accepted shape for it
 * actually narrowed the results, so the ceiling is applied in the app (which has
 * to do it anyway — each profile chooses rent-only or all-in).
 *
 * Set QUINTOANDAR_ENDPOINT to pin a URL if the path moves again.
 */

const ORIGIN = 'https://www.quintoandar.com.br';
const CHANNEL = 'quintoandar';

const OVERRIDE = envOptional('QUINTOANDAR_ENDPOINT');

const ENDPOINT_CANDIDATES = OVERRIDE
  ? [OVERRIDE]
  : [
      'https://apigw.prod.quintoandar.com.br/house-listing-search/v3/search/list',
      // v2 accepts the same body; kept as a fallback in case v3 is withdrawn.
      'https://apigw.prod.quintoandar.com.br/house-listing-search/v2/search/list',
    ];

/** Verified to serve the bare filenames returned in coverImage / imageList. */
const IMAGE_BASE = 'https://www.quintoandar.com.br/img/med';

type Hit = Record<string, unknown>;

/** Extra context from the response envelope, used to fill gaps in each hit. */
type HitContext = {
  /** Neither `state` nor a full address is present per hit; both come from here. */
  state: string | null;
  listingType: SearchTarget['listingType'];
};

/**
 * QuintoAndar scopes a search by its own city slug: "sao-paulo-sp-brasil".
 * Without a state we cannot build one, and the API then falls back to matching
 * `locationDescriptions` loosely.
 */
function citySlug(target: SearchTarget): string {
  return target.state ? `${target.citySlug}-${target.state.toLowerCase()}-brasil` : `${target.citySlug}-brasil`;
}

const FIELDS = [
  'id',
  'coverImage',
  'imageList',
  'rent',
  'totalCost',
  'condoFee',
  'iptu',
  'area',
  'bedrooms',
  'bathrooms',
  'parkingSpaces',
  'address',
  'regionName',
  'neighbourhood',
  'city',
  'state',
  'type',
  'acceptsPets',
  'salePrice',
  'amenities',
  'installations',
  'visitStatus',
];

/** `{ min }` / `{ min, max }`, or an empty object when unconstrained. */
function range(min: number | null, max?: number | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (min) out.min = min;
  if (max) out.max = max;
  return out;
}

export function buildBody(target: SearchTarget, page: number, pageSize: number): Record<string, unknown> {
  const slug = citySlug(target);

  return {
    slug,
    topics: [],
    fields: FIELDS,
    pagination: { pageSize, offset: page * pageSize },
    context: { listShowing: true, mapShowing: false, numPhotos: 12, isSSR: false },
    filters: {
      unknownSlugs: [],
      enableFlexibleSearch: true,
      businessContext: target.listingType === 'SALE' ? 'SALE' : 'RENT',
      location: { viewport: {}, neighborhoods: [], countryCode: 'BR' },
      availability: 'ANY',
      occupancy: 'ANY',
      partnerIds: [],
      specialConditions: [],
      excludedSpecialConditions: [],
      blocklist: [],
      selectedHouses: [],
      categories: [],
      houseSpecs: {
        area: { range: range(target.minSqm) },
        houseTypes: [],
        amenities: [],
        installations: [],
        bathrooms: { range: {} },
        bedrooms: { range: range(target.minBedrooms) },
        parkingSpace: { range: {} },
        suites: { range: {} },
      },
      origin: 'HYBRID',
    },
    locationDescriptions: [{ description: slug }],
  };
}

/** "SOL_DA_MANHA" -> "Sol da manha". Their amenity values are enum constants. */
function humanizeAmenity(value: unknown): string {
  const raw = clean(value, 60);
  if (!raw || !/^[A-Z0-9_]+$/.test(raw)) return raw;
  const words = raw.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) return '';
  return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

export function mapHit(hit: Hit, ctx: HitContext): RawListing | null {
  const source = ((hit._source ?? hit) as Record<string, unknown>) ?? {};
  // `id` comes back as a JSON number here — see idText.
  const externalId = idText(source.id ?? hit._id);
  if (!externalId) return null;

  const rent = toMoney(source.rent);
  const salePrice = toMoney(source.salePrice ?? source.sellingPrice);
  // A sale listing carries rent: 0 and the real number in salePrice.
  const price = ctx.listingType === 'SALE' ? salePrice || rent : rent || salePrice;
  if (!price) return null;

  const city = clean(source.city);
  if (!city) return null;

  // -1 is their "unknown", which must not become a real fee.
  const iptuRaw = toMoney(source.iptu);
  const taxFee = iptuRaw > 0 ? iptuRaw : 0;

  // condoFee is requested but never returned; totalCost is rent + condo + iptu,
  // so the fee is what is left once the two known parts are removed.
  const totalCost = toMoney(source.totalCost);
  const explicitCondo = toMoney(source.condoFee);
  const derivedCondo = totalCost > rent ? totalCost - rent - taxFee : 0;
  const condoFee = explicitCondo || Math.max(0, derivedCondo);

  const neighborhood = clean(source.regionName ?? source.neighbourhood ?? source.neighborhood);
  const address = clean(source.address ?? source.street) || neighborhood || city;
  const description = clean(source.description, 2000);

  const photos = ((source.coverImage ? [source.coverImage] : []) as unknown[])
    .concat((source.imageList as unknown[]) ?? [])
    .map((p) => clean(p))
    .filter(Boolean)
    .map((p) => (p.startsWith('http') ? p : `${IMAGE_BASE}/${p}`));

  const amenities = unique(
    [...(((source.amenities ?? []) as unknown[]) ?? []), ...(((source.installations ?? []) as unknown[]) ?? [])]
      .map(humanizeAmenity)
      .filter(Boolean),
  ).slice(0, 25);

  return {
    externalId,
    sourceUrl: `${ORIGIN}/imovel/${externalId}`,
    title:
      clean(source.title, 200) ||
      `${clean(source.type) || 'Imóvel'} · ${toInt(source.bedrooms)} quartos em ${neighborhood || city}`,
    description: description || null,
    address,
    neighborhood: neighborhood || city,
    city,
    // Per-hit state is not returned; it comes from the response envelope.
    state: clean(source.state) || ctx.state,
    rentPrice: price,
    condoFee,
    taxFee,
    bedrooms: toInt(source.bedrooms),
    bathrooms: toInt(source.bathrooms),
    parkingSpots: toInt(source.parkingSpaces),
    sqm: toInt(source.area ?? source.usableArea),
    images: unique(photos).slice(0, 12),
    amenities,
    // QuintoAndar exposes an explicit flag; fall back to text detection.
    petFriendly:
      typeof source.acceptsPets === 'boolean'
        ? (source.acceptsPets as boolean)
        : detectPetPolicy(`${description} ${amenities.join(' ')}`),
    latitude: typeof source.lat === 'number' ? source.lat : null,
    longitude: typeof source.lng === 'number' ? source.lng : null,
    listingType: ctx.listingType,
  };
}

export type SearchEnvelope = {
  hits: Hit[];
  total: number | null;
  /** UF resolved by the API for this search, e.g. "SP". */
  state: string | null;
};

/** Pulls the hits and the resolved location out of a response. */
export function extractHits(payload: unknown): SearchEnvelope {
  const body = payload as {
    hits?: { hits?: Hit[]; total?: { value?: number } } | Hit[];
    search?: { result?: Hit[] };
    results?: Hit[];
    location?: { state?: string };
  };

  const state = toUf(body?.location?.state);
  const total = Array.isArray(body?.hits) ? null : ((body?.hits as { total?: { value?: number } })?.total?.value ?? null);

  if (Array.isArray(body?.hits)) return { hits: body.hits, total, state };
  const nested = (body?.hits as { hits?: Hit[] })?.hits;
  if (Array.isArray(nested)) return { hits: nested, total, state };
  if (Array.isArray(body?.search?.result)) return { hits: body.search.result, total, state };
  if (Array.isArray(body?.results)) return { hits: body.results, total, state };

  // Shape drifted — look for the hit objects themselves.
  const found = findRecordArray(payload, ['_source']) ?? findRecordArray(payload, ['rent']) ?? [];
  return { hits: found, total, state };
}

export function referer(target: SearchTarget): string {
  const section = target.listingType === 'SALE' ? 'comprar' : 'alugar';
  return `${ORIGIN}/${section}/imovel/${citySlug(target)}`;
}

export const quintoAndarParser: Parser = (() => {
  // Remembered across targets and pages within one run.
  let endpointIndex = 0;

  return {
    source: 'QUINTO_ANDAR',
    label: 'QuintoAndar',

    async search(target: SearchTarget, ctx: ScrapeContext): Promise<RawListing[]> {
      const results: RawListing[] = [];
      const headers = { referer: referer(target) };

      for (let page = 0; page < ctx.maxPages; page += 1) {
        const body = buildBody(target, page, ctx.pageSize);
        let envelope: SearchEnvelope | null = null;

        for (let attempt = 0; attempt < ENDPOINT_CANDIDATES.length && envelope === null; attempt += 1) {
          const index = (endpointIndex + attempt) % ENDPOINT_CANDIDATES.length;
          const url = ENDPOINT_CANDIDATES[index];

          ctx.log.debug(`page ${page + 1}/${ctx.maxPages} · ${url}`);
          const result = await requestJson(ctx, {
            url,
            method: 'POST',
            headers,
            body,
            origin: ORIGIN,
            channel: CHANNEL,
          });

          if (result.ok && result.json !== null) {
            if (index !== endpointIndex) {
              ctx.log.info(`search endpoint moved — now using ${url}`);
              endpointIndex = index;
            }
            envelope = extractHits(result.json);
            break;
          }

          // 404/405 mean this path is gone; keep probing. Anything else is a
          // real failure and should be reported as one.
          const pathGone = result.status === 404 || result.status === 405;
          if (pathGone && attempt < ENDPOINT_CANDIDATES.length - 1) continue;
          throw new Error(describeFailure('QuintoAndar', result));
        }

        if (!envelope || envelope.hits.length === 0) break;
        if (page === 0 && envelope.total !== null) {
          ctx.log.debug(`${envelope.total} listing(s) available for ${citySlug(target)}`);
        }

        const hitContext: HitContext = {
          state: envelope.state ?? target.state,
          listingType: target.listingType,
        };
        for (const hit of envelope.hits) {
          const mapped = mapHit(hit, hitContext);
          if (mapped) results.push(mapped);
        }

        if (envelope.hits.length < ctx.pageSize) break;
        await ctx.delay();
      }

      return applyTargetFilters(results, target);
    },
  };
})();

/** Exposed for doctor.ts so the probe hits exactly what the parser hits. */
export const QUINTOANDAR_PROBE = {
  origin: ORIGIN,
  channel: CHANNEL,
  candidates: ENDPOINT_CANDIDATES,
  buildBody,
  referer,
  citySlug,
};

