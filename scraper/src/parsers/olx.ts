import type { Parser, RawListing, ScrapeContext, SearchTarget } from '../types.js';
import { clean, detectPetPolicy, slugify, toInt, toMoney, unique } from './util.js';

/**
 * OLX.
 *
 * Unlike the other portals, OLX has no convenient public JSON search API, so
 * this is the one parser that actually drives Chromium: it loads the results
 * page and reads the Next.js hydration payload (`__NEXT_DATA__`) that the page
 * already embeds. That is far more stable than CSS selectors, which change with
 * every redesign.
 *
 * ⚠️ OLX fronts its pages with bot protection. Expect this parser to be the
 * first to break, and keep SCRAPE_DELAY_MS generous.
 */

const STATE_PATH: Record<string, string> = {
  SP: 'estado-sp',
  RJ: 'estado-rj',
  MG: 'estado-mg',
  RS: 'estado-rs',
  PR: 'estado-pr',
  SC: 'estado-sc',
  BA: 'estado-ba',
  DF: 'estado-df',
  PE: 'estado-pe',
  CE: 'estado-ce',
};

type OlxAd = Record<string, unknown>;

function readProperty(ad: OlxAd, name: string): string | undefined {
  const props = (ad.properties as Array<{ name?: string; value?: string }> | undefined) ?? [];
  return props.find((p) => p.name === name)?.value;
}

function mapAd(ad: OlxAd, fallbackCity: string): RawListing | null {
  const externalId = clean(ad.listId ?? ad.id, 80);
  const sourceUrl = clean(ad.url, 500);
  if (!externalId || !sourceUrl) return null;

  const rentPrice = toMoney(ad.price);
  if (!rentPrice) return null;

  const location = (ad.location as Record<string, unknown> | undefined) ?? {};
  const neighborhood = clean(location.neighbourhood ?? ad.neighbourhood);
  const city = clean(location.municipality ?? ad.municipality) || fallbackCity;
  const description = clean(ad.subject ?? ad.body, 2000);

  const images = unique(
    (((ad.images ?? ad.thumbnails) as Array<{ original?: string; medium?: string }> | undefined) ?? [])
      .map((i) => clean(i.original ?? i.medium))
      .filter(Boolean),
  ).slice(0, 12);

  return {
    externalId,
    sourceUrl,
    title: clean(ad.subject ?? ad.title, 200) || `Imóvel em ${neighborhood || city}`,
    description: description || null,
    address: clean(ad.address) || neighborhood || city,
    neighborhood: neighborhood || city,
    city,
    state: clean(location.uf) || null,
    rentPrice,
    condoFee: toMoney(readProperty(ad, 'condominio')),
    taxFee: toMoney(readProperty(ad, 'iptu')),
    bedrooms: toInt(readProperty(ad, 'rooms')),
    bathrooms: toInt(readProperty(ad, 'bathrooms')),
    parkingSpots: toInt(readProperty(ad, 'garage_spaces')),
    sqm: toInt(readProperty(ad, 'size')),
    images,
    amenities: [],
    petFriendly: detectPetPolicy(description),
    listingType: 'RENT',
  };
}

export const olxParser: Parser = {
  source: 'OLX',
  label: 'OLX',

  async search(target: SearchTarget, ctx: ScrapeContext): Promise<RawListing[]> {
    const statePath = STATE_PATH[(target.state ?? '').toUpperCase()] ?? 'estado-sp';
    const section = target.listingType === 'SALE' ? 'venda' : 'aluguel';
    const base = `https://www.olx.com.br/imoveis/${section}/${statePath}/${slugify(target.city)}`;

    const page = await ctx.browser.newPage({ userAgent: process.env.SCRAPE_USER_AGENT });
    page.setDefaultNavigationTimeout(45_000);

    // Images and fonts are pure weight for a scraper; blocking them roughly
    // halves the memory footprint per page on a small home server.
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'media') return route.abort();
      return route.continue();
    });

    const results: RawListing[] = [];

    try {
      for (let pageNumber = 1; pageNumber <= ctx.maxPages; pageNumber += 1) {
        const params = new URLSearchParams({ o: String(pageNumber) });
        if (target.minPrice) params.set('ps', String(target.minPrice));
        if (target.maxPrice) params.set('pe', String(target.maxPrice));
        if (target.minBedrooms) params.set('ros', String(target.minBedrooms));

        const url = `${base}?${params.toString()}`;
        ctx.log.debug(`OLX: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const json = await page
          .locator('#__NEXT_DATA__')
          .textContent({ timeout: 15_000 })
          .catch(() => null);

        if (!json) {
          ctx.log.warn('OLX: no __NEXT_DATA__ on the page (bot wall or layout change)');
          break;
        }

        const data = JSON.parse(json) as {
          props?: { pageProps?: { ads?: OlxAd[]; listingProps?: { adList?: OlxAd[] } } };
        };
        const ads = data.props?.pageProps?.ads ?? data.props?.pageProps?.listingProps?.adList ?? [];
        if (ads.length === 0) break;

        for (const ad of ads) {
          const mapped = mapAd(ad, target.city);
          if (mapped) results.push(mapped);
        }

        await ctx.delay();
      }
    } finally {
      await page.close().catch(() => undefined);
    }

    if (target.neighborhoods.length) {
      const wanted = new Set(target.neighborhoods.map((n) => n.toLowerCase()));
      return results.filter((r) => wanted.has(r.neighborhood.toLowerCase()));
    }

    return results;
  },
};
