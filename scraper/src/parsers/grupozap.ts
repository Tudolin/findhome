import type { PropertySource } from '@prisma/client';
import type { Parser, RawListing, ScrapeContext, SearchTarget } from '../types.js';
import { clean, detectPetPolicy, toInt, toMoney, unique } from './util.js';

/**
 * ZAP Imóveis and Viva Real.
 *
 * Both portals are operated by Grupo ZAP and are served by the same "glue"
 * JSON API; only the `x-domain` header and the canonical link host differ.
 * Reading the JSON directly is far cheaper on a home server than rendering
 * their React app in Chromium, so this parser uses the shared APIRequestContext
 * and never opens a page.
 *
 * ⚠️ This endpoint is undocumented and unversioned in practice. If a run
 * suddenly returns zero listings, open the portal in a browser, watch the
 * network tab for the `/v2/listings` call, and update ENDPOINT / the query
 * parameters below. The mapping code is written defensively so a changed field
 * degrades to a skipped listing instead of a crash.
 */

const ENDPOINT = process.env.GRUPOZAP_ENDPOINT ?? 'https://glue-api.zapimoveis.com.br/v2/listings';

const PORTALS: Record<'ZAP' | 'VIVA_REAL', { domain: string; origin: string; label: string }> = {
  ZAP: { domain: 'www.zapimoveis.com.br', origin: 'https://www.zapimoveis.com.br', label: 'Zap Imóveis' },
  VIVA_REAL: { domain: 'www.vivareal.com.br', origin: 'https://www.vivareal.com.br', label: 'Viva Real' },
};

const INCLUDE_FIELDS = [
  'search(result(listings(listing(id,title,description,unitTypes,usableAreas,bedrooms,bathrooms,',
  'parkingSpaces,amenities,pricingInfos,address,images,link),link,medias)),totalCount)',
].join('');

type GlueListing = Record<string, unknown>;

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

function mapListing(raw: GlueListing, portalOrigin: string): RawListing | null {
  const listing = (raw.listing ?? raw) as Record<string, unknown>;
  const externalId = clean(listing.id ?? raw.id, 80);
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
    [
      ...((listing.images as string[] | undefined) ?? []),
      ...medias.map((m) => clean(m.url)),
    ]
      .filter(Boolean)
      // The API returns templated URLs like .../{action}/{width}x{height}/...
      .map((url) => url.replace('{action}', 'fit-in').replace('{width}x{height}', '800x600'))
      .slice(0, 12),
  );

  const amenities = unique(
    ((listing.amenities as string[] | undefined) ?? []).map((a) => clean(a, 60)).filter(Boolean),
  ).slice(0, 25);

  const description = clean(listing.description, 2000);

  return {
    externalId,
    sourceUrl,
    title: clean(listing.title, 200) || `Imóvel em ${location.neighborhood || location.city}`,
    description: description || null,
    ...location,
    rentPrice,
    condoFee: toMoney(rental.monthlyCondoFee),
    taxFee: toMoney(rental.yearlyIptu) > 0 ? Math.round(toMoney(rental.yearlyIptu) / 12) : 0,
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

function buildParser(source: 'ZAP' | 'VIVA_REAL'): Parser {
  const portal = PORTALS[source];

  return {
    source: source as PropertySource,
    label: portal.label,

    async search(target: SearchTarget, ctx: ScrapeContext): Promise<RawListing[]> {
      const results: RawListing[] = [];

      for (let page = 0; page < ctx.maxPages; page += 1) {
        const params: Record<string, string> = {
          business: target.listingType === 'SALE' ? 'SALE' : 'RENTAL',
          listingType: 'USED',
          categoryPage: 'RESULT',
          includeFields: INCLUDE_FIELDS,
          size: String(ctx.pageSize),
          from: String(page * ctx.pageSize),
          addressCity: target.city,
          ...(target.state ? { addressState: target.state } : {}),
          ...(target.minPrice ? { priceMin: String(target.minPrice) } : {}),
          ...(target.maxPrice ? { priceMax: String(target.maxPrice) } : {}),
          ...(target.minBedrooms ? { bedrooms: String(target.minBedrooms) } : {}),
          ...(target.minSqm ? { usableAreasMin: String(target.minSqm) } : {}),
        };

        const query = new URLSearchParams(params).toString();
        ctx.log.debug(`${portal.label}: page ${page + 1}/${ctx.maxPages}`);

        const response = await ctx.api.get(`${ENDPOINT}?${query}`, {
          headers: {
            'x-domain': portal.domain,
            origin: portal.origin,
            referer: `${portal.origin}/`,
          },
        });

        if (!response.ok()) {
          throw new Error(`${portal.label} responded ${response.status()} ${response.statusText()}`);
        }

        const payload = (await response.json()) as {
          search?: { result?: { listings?: GlueListing[] } };
        };
        const listings = payload.search?.result?.listings ?? [];
        if (listings.length === 0) break;

        for (const raw of listings) {
          const mapped = mapListing(raw, portal.origin);
          if (mapped) results.push(mapped);
        }

        if (listings.length < ctx.pageSize) break;
        await ctx.delay();
      }

      // Neighborhood filtering happens client-side: the portal's own
      // neighborhood parameter needs internal location ids we would have to
      // resolve with an extra request per neighborhood.
      if (target.neighborhoods.length) {
        const wanted = new Set(target.neighborhoods.map((n) => n.toLowerCase()));
        return results.filter((r) => wanted.has(r.neighborhood.toLowerCase()));
      }

      return results;
    },
  };
}

export const zapParser = buildParser('ZAP');
export const vivaRealParser = buildParser('VIVA_REAL');
