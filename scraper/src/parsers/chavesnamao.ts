import type { Page } from 'playwright-core';
import { buildPageParser, collectPayloads, type PageParserConfig } from './page.js';
import { clean, detectPetPolicy, idText, toInt, toMoney, unique } from './util.js';
import { toUf } from '../locations.js';
import type { RawListing, SearchTarget } from '../types.js';

/**
 * Chaves na Mão.
 *
 * The happy case among the page-scraped portals: every search page publishes a
 * complete schema.org `Offer` list for search engines, which is both richer and
 * far more stable than the markup around it — structured data is a contract with
 * Google, so it does not get rewritten on a redesign.
 *
 * The shape below was read off the live site and is exact:
 *
 *   { "@type": "Offer", name, url, price: "1750", priceCurrency: "BRL",
 *     itemOffered: { numberOfBedrooms, numberOfBathroomsTotal,
 *                    floorSize: { unitText: "112m²" },
 *                    address: { streetAddress, addressLocality: "Vila Mariana",
 *                               addressRegion: "São Paulo, SP" },
 *                    geo: { latitude, longitude }, image } }
 *
 * Note the address mapping, which is not what the field names suggest:
 * `addressLocality` is the NEIGHBORHOOD and `addressRegion` is "City, UF".
 *
 * Not available in the structured data: condo fee and IPTU. Those stay 0, so the
 * app's all-in ceiling treats these listings as rent-only. That is a real gap,
 * and an honest one — inventing a fee would be worse.
 */

const ORIGIN = 'https://www.chavesnamao.com.br';

/**
 * Their location segment is "uf-cidade" ("sp-sao-paulo", "pr-curitiba"),
 * verified live. The UF is not optional: `/imoveis-para-alugar/curitiba/`
 * answers 200 with an empty result set rather than redirecting, which is why the
 * config below sets `requiresState`.
 */
function urls(target: SearchTarget, pageNumber: number): string[] {
  const section = target.listingType === 'SALE' ? 'imoveis-a-venda' : 'imoveis-para-alugar';
  const paged = pageNumber > 1 ? `?pg=${pageNumber}` : '';
  const uf = (target.state ?? '').toLowerCase();

  return [`${ORIGIN}/${section}/${uf}-${target.citySlug}/${paged}`];
}

type Offer = Record<string, unknown>;

/** "São Paulo, SP" -> { city, uf } */
function splitRegion(value: unknown): { city: string; uf: string | null } {
  const parts = clean(value, 120)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { city: '', uf: null };
  return { city: parts[0], uf: toUf(parts[1]) };
}

/**
 * The structured data links a 340px thumbnail; the path segment is the size.
 * Measured on the same file:
 *
 *   /imn/0340X0250/   340x250     4 kB
 *   /imn/0800X0600/   800x600    12 kB
 *   /imn/1600X1200/  1600x1024   27 kB   <- used here (aspect is preserved)
 */
function upgradeImage(url: string): string {
  return url.replace(/\/imn\/\d+X\d+\//i, '/imn/1600X1200/');
}

/** The listing id is the /id-NNNNNNNN/ segment of the URL. */
function idFromUrl(url: string): string {
  const match = url.match(/\/id-(\d+)/);
  return match ? match[1] : '';
}

export function mapOffer(offer: Offer, target: SearchTarget): RawListing | null {
  const url = clean(offer.url ?? (offer.itemOffered as Offer | undefined)?.['@id'], 500);
  if (!url) return null;

  const externalId = idText(idFromUrl(url));
  if (!externalId) return null;

  const rentPrice = toMoney(offer.price);
  if (!rentPrice) return null;

  // Each Offer declares schema.org/RentAction or schema.org/BuyAction. The rent
  // pages carry a few sale offers (and vice versa), and without this check a
  // R$ 129.120 sale price lands in the feed as a monthly rent.
  const action = clean(offer.potentialAction, 120);
  if (action) {
    const isSale = /BuyAction|SellAction/i.test(action);
    if (isSale !== (target.listingType === 'SALE')) return null;
  }

  const item = (offer.itemOffered ?? {}) as Offer;
  const address = (item.address ?? {}) as Offer;
  const geo = (item.geo ?? {}) as Offer;

  // addressLocality is the neighborhood here, and addressRegion is "City, UF".
  const neighborhood = clean(address.addressLocality, 120);
  const { city, uf } = splitRegion(address.addressRegion);
  if (!city) return null;

  const title = clean(offer.name, 200);
  const floorSize = (item.floorSize ?? {}) as Offer;
  // floorSize is missing on a fair number of offers, but the URL slug always
  // carries the area ("...-vila-mariana-23m2-RS1750/id-43987622/"). Falling back
  // to it keeps the m² filter usable instead of storing 0.
  const sqmFromUrl = toInt(url.match(/-(\d+)m2[-/]/)?.[1]);
  const image = clean(item.image ?? offer.image, 500);
  const agent = clean((offer.offeredBy as Offer | undefined)?.name, 120);

  const latitude = Number.parseFloat(clean(geo.latitude, 40));
  const longitude = Number.parseFloat(clean(geo.longitude, 40));

  return {
    externalId,
    sourceUrl: url,
    title: title || `Imóvel em ${neighborhood || city}`,
    // The Offer's `name` is the only prose published; keep the agent alongside it
    // so the card shows who is letting the place.
    description: agent ? `${title} — ${agent}` : title || null,
    address: clean(address.streetAddress, 300) || neighborhood || city,
    neighborhood: neighborhood || city,
    city,
    state: uf ?? target.state,
    rentPrice,
    // Not published in the structured data. See the note at the top of the file.
    condoFee: 0,
    taxFee: 0,
    bedrooms: toInt(item.numberOfBedrooms ?? item.numberOfRooms),
    bathrooms: toInt(item.numberOfBathroomsTotal ?? item.numberOfBathrooms),
    parkingSpots: 0,
    // "112m²" — toInt takes the leading digits.
    sqm: toInt(floorSize.unitText ?? floorSize.value) || sqmFromUrl,
    images: unique([upgradeImage(image)].filter(Boolean)),
    amenities: [],
    petFriendly: detectPetPolicy(title),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    listingType: target.listingType,
  };
}

/**
 * The Offer list lives at `offers.itemListElement` of the page's main ld+json
 * block. Both that path and a shape-based search are tried, so a move within the
 * document does not break the parser.
 */
export function extractOffers(payloads: unknown[]): Offer[] {
  for (const payload of payloads) {
    const list = (payload as { offers?: { itemListElement?: unknown } })?.offers?.itemListElement;
    if (Array.isArray(list) && list.length > 0) return list as Offer[];
  }

  for (const payload of payloads) {
    const list = (payload as { itemListElement?: unknown })?.itemListElement;
    if (Array.isArray(list) && list.length > 0) {
      const offers = (list as Offer[]).filter((o) => o.price !== undefined && o.url !== undefined);
      if (offers.length > 0) return offers;
    }
  }

  return [];
}

export const CHAVES_NA_MAO_CONFIG: PageParserConfig = {
  label: 'Chaves na Mão',
  origin: ORIGIN,
  urls,
  requiresState: true,
  async extract(page: Page, target: SearchTarget): Promise<RawListing[]> {
    const offers = extractOffers(await collectPayloads(page));
    return offers.map((offer) => mapOffer(offer, target)).filter((l): l is RawListing => l !== null);
  },
};

export const chavesNaMaoParser = buildPageParser('CHAVES_NA_MAO', CHAVES_NA_MAO_CONFIG);

