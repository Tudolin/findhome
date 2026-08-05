import type { PropertySource } from '@prisma/client';
import { DEVICE_ID } from '../browser.js';
import { env } from '../config.js';
import { describeFailure, requestJson } from '../http.js';
import { asciiName, ufToStateName } from '../locations.js';
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
 * ZAP Imóveis and Viva Real.
 *
 * Both portals are operated by Grupo ZAP and are served by the same "glue"
 * JSON API; only the `x-domain` header and the canonical link host differ.
 * Reading the JSON directly is far cheaper on a home server than rendering
 * their React app in Chromium.
 *
 * Two things about this endpoint have bitten this project before, and both are
 * handled here rather than left as a comment:
 *
 *  1. It is behind a bot wall that fingerprints TLS, so a plain Node request
 *     gets 403 no matter what headers it sends. `requestJson` falls back to
 *     issuing the call from inside a real Chromium page — see http.ts.
 *  2. The query contract drifts. Rather than one hard-coded parameter set that
 *     turns into a 400 the day a field is renamed, PARAM_VARIANTS holds three
 *     progressively more conservative sets and the first that answers wins.
 *     `make doctor` prints which one is in use.
 *
 * Override the host with GRUPOZAP_ENDPOINT if it ever moves.
 */

const ENDPOINT = env('GRUPOZAP_ENDPOINT', 'https://glue-api.zapimoveis.com.br/v2/listings');

const PORTALS: Record<'ZAP' | 'VIVA_REAL', { domain: string; origin: string; label: string }> = {
  ZAP: { domain: 'www.zapimoveis.com.br', origin: 'https://www.zapimoveis.com.br', label: 'Zap Imóveis' },
  VIVA_REAL: { domain: 'www.vivareal.com.br', origin: 'https://www.vivareal.com.br', label: 'Viva Real' },
};

/**
 * Projection asked of the API. Kept to fields this parser actually reads: every
 * extra field is one more thing that can be renamed into a 400.
 */
const INCLUDE_FIELDS = env(
  'GRUPOZAP_INCLUDE_FIELDS',
  'search(result(listings(listing(id,title,description,usableAreas,bedrooms,bathrooms,' +
    'parkingSpaces,amenities,pricingInfos,address,images),link(href))),totalCount)',
);

type GlueListing = Record<string, unknown>;

/**
 * Grupo ZAP scopes a search by a composite location id built from unaccented
 * display names: "BR>Sao Paulo>NULL>Sao Paulo" (country, state, region, city).
 * Without it the API answers with results for the wrong place — which is how a
 * search for Curitiba came back looking like São Paulo.
 */
function locationId(city: string, state: string | null): string | null {
  const stateName = ufToStateName(state);
  if (!stateName) return null;
  return `BR>${asciiName(stateName)}>NULL>${asciiName(city)}`;
}

type ParamVariant = { name: string; build: (target: SearchTarget, from: number, size: number) => Record<string, string> };

/**
 * Tried in order until one answers. Narrowest first, so a healthy API still
 * gets the precise query; each fallback drops the parameter most likely to have
 * been renamed.
 */
const PARAM_VARIANTS: ParamVariant[] = [
  {
    name: 'locationId',
    build: (target, from, size) => {
      const id = locationId(target.city, target.state);
      const stateName = ufToStateName(target.state);
      return {
        business: target.listingType === 'SALE' ? 'SALE' : 'RENTAL',
        listingType: 'USED',
        categoryPage: 'RESULT',
        includeFields: INCLUDE_FIELDS,
        size: String(size),
        from: String(from),
        addressCity: target.city,
        addressType: 'city',
        addressCountry: 'Brasil',
        ...(stateName ? { addressState: stateName } : {}),
        ...(id ? { addressLocationId: id } : {}),
        ...priceParams(target),
      };
    },
  },
  {
    name: 'city+state',
    build: (target, from, size) => {
      const stateName = ufToStateName(target.state);
      return {
        business: target.listingType === 'SALE' ? 'SALE' : 'RENTAL',
        listingType: 'USED',
        categoryPage: 'RESULT',
        includeFields: INCLUDE_FIELDS,
        size: String(size),
        from: String(from),
        addressCity: target.city,
        ...(stateName ? { addressState: stateName } : {}),
        ...priceParams(target),
      };
    },
  },
  {
    // No projection and no state: the smallest query the endpoint accepts.
    name: 'bare',
    build: (target, from, size) => ({
      business: target.listingType === 'SALE' ? 'SALE' : 'RENTAL',
      categoryPage: 'RESULT',
      size: String(size),
      from: String(from),
      addressCity: target.city,
    }),
  },
];

function priceParams(target: SearchTarget): Record<string, string> {
  return {
    ...(target.minPrice ? { priceMin: String(target.minPrice) } : {}),
    ...(target.maxPrice ? { priceMax: String(target.maxPrice) } : {}),
    ...(target.minSqm ? { usableAreasMin: String(target.minSqm) } : {}),
  };
}

function pickAddress(address: Record<string, unknown> | undefined) {
  const street = clean(address?.street);
  const number = clean(address?.streetNumber);
  const neighborhood = clean(address?.neighborhood);
  const city = clean(address?.city);
  const state = clean(address?.stateAcronym) || clean(address?.state);
  const point = address?.geoLocation as { location?: { lat?: number; lon?: number } } | undefined;

  return {
    address: [street, number].filter(Boolean).join(', ') || neighborhood || city,
    neighborhood,
    city,
    state: state || null,
    latitude: point?.location?.lat ?? null,
    longitude: point?.location?.lon ?? null,
  };
}

export function mapListing(raw: GlueListing, portalOrigin: string): RawListing | null {
  const listing = (raw.listing ?? raw) as Record<string, unknown>;
  const externalId = idText(listing.id ?? raw.id);
  if (!externalId) return null;

  const pricing = (listing.pricingInfos as Array<Record<string, unknown>> | undefined) ?? [];
  // A listing can carry both RENTAL and SALE pricing; rent is what we track.
  const rental = pricing.find((p) => String(p.businessType).toUpperCase() === 'RENTAL') ?? pricing[0];
  if (!rental) return null;

  const rentPrice = toMoney(rental.price ?? rental.rentalTotalPrice);
  if (!rentPrice) return null;

  const location = pickAddress(listing.address as Record<string, unknown> | undefined);
  if (!location.city) return null;

  const link = clean(raw.link && (raw.link as Record<string, unknown>).href) || clean(listing.href);
  const sourceUrl = link
    ? link.startsWith('http')
      ? link
      : `${portalOrigin}${link.startsWith('/') ? '' : '/'}${link}`
    : `${portalOrigin}/imovel/${externalId}/`;

  const medias = (raw.medias as Array<Record<string, unknown>> | undefined) ?? [];
  const images = unique(
    [...((listing.images as string[] | undefined) ?? []), ...medias.map((m) => clean(m.url))]
      .filter(Boolean)
      // The API returns templated URLs like .../{action}/{width}x{height}/...
      .map((url) => url.replace('{action}', 'fit-in').replace('{width}x{height}', '800x600'))
      .slice(0, 12),
  );

  const amenities = unique(
    ((listing.amenities as string[] | undefined) ?? []).map((a) => clean(a, 60)).filter(Boolean),
  ).slice(0, 25);

  const description = clean(listing.description, 2000);
  const yearlyIptu = toMoney(rental.yearlyIptu);

  return {
    externalId,
    sourceUrl,
    title: clean(listing.title, 200) || `Imóvel em ${location.neighborhood || location.city}`,
    description: description || null,
    ...location,
    rentPrice,
    condoFee: toMoney(rental.monthlyCondoFee),
    taxFee: yearlyIptu > 0 ? Math.round(yearlyIptu / 12) : 0,
    bedrooms: toInt(listing.bedrooms),
    bathrooms: toInt(listing.bathrooms),
    parkingSpots: toInt(listing.parkingSpaces),
    sqm: toInt(listing.usableAreas),
    images,
    amenities,
    petFriendly: detectPetPolicy(`${description} ${amenities.join(' ')}`),
    listingType: 'RENT',
  };
}

/** Pulls the listing array out of whichever shape the payload arrived in. */
export function extractListings(payload: unknown): GlueListing[] {
  const known = (payload as { search?: { result?: { listings?: GlueListing[] } } })?.search?.result?.listings;
  if (Array.isArray(known)) return known;

  // Shape drifted — look for the listing objects themselves.
  return findRecordArray(payload, ['listing']) ?? findRecordArray(payload, ['pricingInfos']) ?? [];
}

function buildQuery(variant: ParamVariant, target: SearchTarget, from: number, size: number): string {
  return new URLSearchParams(variant.build(target, from, size)).toString();
}

function buildParser(source: 'ZAP' | 'VIVA_REAL'): Parser {
  const portal = PORTALS[source];
  const channel = `grupozap:${source}`;

  // Remembered across targets and pages within one run: once a variant answers,
  // the other two are not worth another round-trip.
  let variantIndex = 0;

  return {
    source: source as PropertySource,
    label: portal.label,

    async search(target: SearchTarget, ctx: ScrapeContext): Promise<RawListing[]> {
      const results: RawListing[] = [];
      const headers = { 'x-domain': portal.domain, 'x-deviceid': DEVICE_ID };

      for (let page = 0; page < ctx.maxPages; page += 1) {
        const from = page * ctx.pageSize;
        let listings: GlueListing[] | null = null;

        // Start from the variant that worked last time, then try the rest.
        for (let attempt = 0; attempt < PARAM_VARIANTS.length && listings === null; attempt += 1) {
          const index = (variantIndex + attempt) % PARAM_VARIANTS.length;
          const variant = PARAM_VARIANTS[index];
          const query = buildQuery(variant, target, from, ctx.pageSize);

          ctx.log.debug(`page ${page + 1}/${ctx.maxPages} · variant "${variant.name}"`);
          const result = await requestJson(ctx, {
            url: `${ENDPOINT}?${query}`,
            headers,
            origin: portal.origin,
            channel,
          });

          if (result.ok && result.json !== null) {
            if (index !== variantIndex) {
              ctx.log.info(`query variant "${PARAM_VARIANTS[variantIndex].name}" rejected, using "${variant.name}"`);
              variantIndex = index;
            }
            listings = extractListings(result.json);
            break;
          }

          // A 4xx here is the contract having moved, not a dead portal: fall
          // through to the next variant. Anything else is fatal for this source.
          if (result.status >= 400 && result.status < 500 && attempt < PARAM_VARIANTS.length - 1) {
            ctx.log.debug(`variant "${variant.name}" returned ${result.status}, trying the next one`);
            continue;
          }
          throw new Error(describeFailure(portal.label, result));
        }

        if (!listings || listings.length === 0) break;

        for (const raw of listings) {
          const mapped = mapListing(raw, portal.origin);
          if (mapped) results.push(mapped);
        }

        if (listings.length < ctx.pageSize) break;
        await ctx.delay();
      }

      return applyTargetFilters(results, target);
    },
  };
}

export const zapParser = buildParser('ZAP');
export const vivaRealParser = buildParser('VIVA_REAL');

/** Exposed for doctor.ts so the probe hits exactly what the parser hits. */
export const GRUPOZAP_PROBE = {
  endpoint: ENDPOINT,
  portals: PORTALS,
  variants: PARAM_VARIANTS,
  headers: () => ({ 'x-deviceid': DEVICE_ID }),
};
