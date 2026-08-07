import type { Parser, RawListing, SearchTarget } from '../types.js';

/**
 * Offline parser. Makes no network calls — it synthesises listings that match
 * the search target.
 *
 * This exists so you can verify the full pipeline (cron -> parser -> de-dup ->
 * database -> UI) on a fresh install without depending on any external site,
 * and so the app is demonstrable when a portal parser inevitably breaks.
 * Enable with SCRAPE_SOURCES=DEMO.
 */

const STREETS = [
  'Rua das Palmeiras',
  'Av. Brigadeiro Faria Lima',
  'Rua Augusta',
  'Rua Girassol',
  'Av. Pompeia',
  'Rua Cardeal Arcoverde',
  'Rua Turiassu',
  'Rua Wisard',
];

const FEATURES = [
  ['Elevador', 'Portaria 24h'],
  ['Academia', 'Piscina', 'Elevador'],
  ['Churrasqueira', 'Varanda'],
  ['Mobiliado', 'Lavanderia'],
  ['Coworking', 'Portaria 24h', 'Elevador'],
];

/** Deterministic pseudo-random so repeated runs produce stable external ids. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export const demoParser: Parser = {
  source: 'DEMO',
  label: 'Demo generator (offline)',

  async search(target: SearchTarget): Promise<RawListing[]> {
    const neighborhoods = target.neighborhoods.length ? target.neighborhoods : ['Centro'];
    const listings: RawListing[] = [];

    for (const neighborhood of neighborhoods) {
      for (let n = 0; n < 4; n += 1) {
        const seed = hash(`${target.city}|${neighborhood}|${n}`);
        const bedrooms = Math.max(target.minBedrooms, 1 + (seed % 3));
        const sqm = Math.max(target.minSqm, 35 + (seed % 90));
        // Prices have to be on the right scale for the mode being tested: a Buy
        // run that synthesised R$ 1.800 "sale" listings would make the purchase
        // filters look broken when they are not.
        const forSale = target.listingType === 'SALE';
        const floor = target.minPrice ?? (forSale ? 250_000 : 1800);
        const ceiling = target.maxPrice ?? floor + (forSale ? 600_000 : 4000);
        const step = forSale ? 1000 : 1;
        const span = Math.max(1, Math.floor((ceiling - floor) / step));
        const price = floor + (seed % span) * step;
        // A sale's condo fee is a monthly running cost, not a slice of the price.
        const condoFee = forSale ? 300 + (seed % 900) : Math.round(price * 0.2);
        const externalId = `demo-${seed.toString(36)}`;

        listings.push({
          externalId,
          sourceUrl: `https://demo.findhome.local/imovel/${externalId}`,
          title: `${bedrooms} dormitórios em ${neighborhood}`,
          description: `Listagem sintética gerada pelo parser DEMO para ${neighborhood}, ${target.city}.`,
          address: `${STREETS[seed % STREETS.length]}, ${100 + (seed % 900)}`,
          neighborhood,
          city: target.city,
          state: target.state ?? null,
          // `rentPrice` is the headline price whatever the type — monthly rent,
          // or the asking price. See normalize() in persist.ts.
          rentPrice: price,
          condoFee,
          taxFee: forSale ? Math.round(price * 0.01 / 12) : Math.round(price * 0.04),
          bedrooms,
          bathrooms: 1 + (seed % 2),
          parkingSpots: seed % 3,
          sqm,
          images: [
            `https://picsum.photos/seed/${externalId}-a/800/600`,
            `https://picsum.photos/seed/${externalId}-b/800/600`,
          ],
          amenities: FEATURES[seed % FEATURES.length],
          petFriendly: seed % 3 !== 0,
          listingType: target.listingType,
        });
      }
    }

    return listings;
  },
};
