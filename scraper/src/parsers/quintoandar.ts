import type { Parser, RawListing, ScrapeContext, SearchTarget } from '../types.js';
import { clean, detectPetPolicy, slugify, toInt, toMoney, unique } from './util.js';

/**
 * QuintoAndar.
 *
 * Their search page is a client-rendered app backed by a JSON search endpoint.
 * We call that endpoint directly and fall back to nothing if the contract has
 * moved (the runner records the failure per source, so the other portals still
 * complete).
 *
 * ⚠️ Undocumented endpoint — verify against the site's network tab if results
 * dry up, and override with QUINTOANDAR_ENDPOINT if the host changes.
 */

const ENDPOINT =
  process.env.QUINTOANDAR_ENDPOINT ??
  'https://apigw.prod.quintoandar.com.br/cached/house-listing-search/v2/search/list';

const IMAGE_BASE = 'https://www.quintoandar.com.br/img/med';

type Hit = Record<string, unknown>;

function mapHit(hit: Hit): RawListing | null {
  const source = ((hit._source ?? hit) as Record<string, unknown>) ?? {};
  const externalId = clean(source.id ?? hit._id, 80);
  if (!externalId) return null;

  const rentPrice = toMoney(source.rent ?? source.rentValue ?? source.salePrice);
  if (!rentPrice) return null;

  const city = clean(source.city);
  if (!city) return null;

  const neighborhood = clean(source.regionName ?? source.neighbourhood ?? source.neighborhood);
  const address = clean(source.address ?? source.street) || neighborhood || city;
  const description = clean(source.description ?? source.visitStatus, 2000);

  const photos = ((source.coverImage ? [source.coverImage] : []) as unknown[])
    .concat((source.imageList as unknown[]) ?? [])
    .map((p) => clean(p))
    .filter(Boolean)
    .map((p) => (p.startsWith('http') ? p : `${IMAGE_BASE}/${p}`));

  const amenities = unique(
    (((source.amenities ?? source.specialConditions) as string[] | undefined) ?? [])
      .map((a) => clean(a, 60))
      .filter(Boolean),
  ).slice(0, 25);

  return {
    externalId,
    sourceUrl: `https://www.quintoandar.com.br/imovel/${externalId}`,
    title: clean(source.title, 200) || `${toInt(source.bedrooms)} quartos em ${neighborhood || city}`,
    description: description || null,
    address,
    neighborhood: neighborhood || city,
    city,
    state: clean(source.state) || null,
    rentPrice,
    condoFee: toMoney(source.condoFee ?? source.iptuPlusCondominium),
    taxFee: toMoney(source.iptu),
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
    listingType: 'RENT',
  };
}

export const quintoAndarParser: Parser = {
  source: 'QUINTO_ANDAR',
  label: 'QuintoAndar',

  async search(target: SearchTarget, ctx: ScrapeContext): Promise<RawListing[]> {
    const results: RawListing[] = [];

    for (let page = 0; page < ctx.maxPages; page += 1) {
      ctx.log.debug(`QuintoAndar: page ${page + 1}/${ctx.maxPages}`);

      const response = await ctx.api.post(ENDPOINT, {
        headers: {
          'content-type': 'application/json',
          origin: 'https://www.quintoandar.com.br',
          referer: `https://www.quintoandar.com.br/alugar/imovel/${slugify(target.city)}-${slugify(
            target.state ?? '',
          )}-brasil`,
        },
        data: {
          context: { mapShowing: false, listShowing: true, isSSR: true },
          filters: {
            businessContext: target.listingType === 'SALE' ? 'SALE' : 'RENT',
            availability: 'any',
            occupancy: 'any',
            sorting: { criteria: 'relevance', order: 'desc' },
            pageSize: ctx.pageSize,
            page,
            ...(target.maxPrice ? { priceRange: [target.minPrice ?? 0, target.maxPrice] } : {}),
            ...(target.minBedrooms ? { bedrooms: target.minBedrooms } : {}),
            ...(target.minSqm ? { areaRange: [target.minSqm, 100000] } : {}),
            searchTerms: [target.city, target.state].filter(Boolean).join(', '),
          },
          fields: [
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
            'city',
            'state',
            'type',
            'acceptsPets',
            'amenities',
          ],
        },
      });

      if (!response.ok()) {
        throw new Error(`QuintoAndar responded ${response.status()} ${response.statusText()}`);
      }

      const payload = (await response.json()) as { hits?: { hits?: Hit[] }; search?: { result?: Hit[] } };
      const hits = payload.hits?.hits ?? payload.search?.result ?? [];
      if (hits.length === 0) break;

      for (const hit of hits) {
        const mapped = mapHit(hit);
        if (mapped) results.push(mapped);
      }

      if (hits.length < ctx.pageSize) break;
      await ctx.delay();
    }

    if (target.neighborhoods.length) {
      const wanted = new Set(target.neighborhoods.map((n) => n.toLowerCase()));
      return results.filter((r) => wanted.has(r.neighborhood.toLowerCase()));
    }

    return results;
  },
};
