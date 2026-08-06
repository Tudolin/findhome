import type { Page } from 'playwright-core';
import { buildPageParser, type PageParserConfig } from './page.js';
import { clean, detectPetPolicy, idText, toInt, toMoney, unique } from './util.js';
import type { RawListing, SearchTarget } from '../types.js';

/**
 * ImovelWeb.
 *
 * Runs on Navent's platform (the same codebase as Zonaprop and Inmuebles24).
 * The search page renders its cards server-side and marks them up with `data-qa`
 * attributes — test hooks, which makes them a good thing to depend on: they exist
 * so Navent's own test suite can find these elements, so they outlive visual
 * redesigns.
 *
 * Its schema.org blocks were checked first and rejected: the `mainEntity` entries
 * carry the agency name and description but no price, so nothing could be built
 * from them.
 *
 * Verified against the live site:
 *   div[data-id="3031753975"][data-to-posting="/propriedades/....html"]
 *     [data-qa="POSTING_CARD_PRICE"]     "R$ 85.000"
 *     [data-qa="expensas"]               condo fee, often empty
 *     [data-qa="POSTING_CARD_LOCATION"]  "Jardim Everest, São Paulo"
 *     [data-qa="POSTING_CARD_FEATURES"]  spans: "1360 m² tot." "5 quartos" "5 ban." "13 vagas"
 */

const ORIGIN = 'https://www.imovelweb.com.br';

function urls(target: SearchTarget, pageNumber: number): string[] {
  const section = target.listingType === 'SALE' ? 'imoveis-venda' : 'imoveis-aluguel';
  const suffix = pageNumber > 1 ? `-pagina-${pageNumber}` : '';
  const uf = target.state?.toLowerCase();

  return [
    ...(uf ? [`${ORIGIN}/${section}-${target.citySlug}-${uf}${suffix}.html`] : []),
    `${ORIGIN}/${section}-${target.citySlug}${suffix}.html`,
  ];
}

type Card = {
  id: string;
  href: string;
  price: string;
  expenses: string;
  location: string;
  features: string[];
  description: string;
  images: string[];
};

/** Runs in the page. Returns plain data so all parsing stays in typed Node code. */
function readCards(): Card[] {
  type El = {
    querySelector: (s: string) => El | null;
    querySelectorAll: (s: string) => ArrayLike<El>;
    getAttribute: (name: string) => string | null;
    textContent: string | null;
  };
  const scope = globalThis as unknown as { document: { querySelectorAll: (s: string) => ArrayLike<El> } };

  const cards = scope.document.querySelectorAll('div[data-qa="posting PROPERTY"], div[data-id][data-to-posting]');
  const out: Card[] = [];

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    const text = (selector: string) => card.querySelector(selector)?.textContent?.trim() ?? '';
    const list = (selector: string) => {
      const nodes = card.querySelectorAll(selector);
      const values: string[] = [];
      for (let n = 0; n < nodes.length; n += 1) values.push(nodes[n].textContent?.trim() ?? '');
      return values.filter(Boolean);
    };
    // Navent's card carousel is lazy: only the visible slide has a real `src`,
    // the rest park theirs in `data-src`/`srcset` until Flickity swaps them in.
    // Reading `src ?? data-src` (either/or) missed the ones that had both, which
    // is why most cards yielded a single photo. All of them are collected now;
    // the full gallery still comes from the listing page (see photos.ts).
    const images: string[] = [];
    const imgs = card.querySelectorAll('img');
    for (let n = 0; n < imgs.length; n += 1) {
      const img = imgs[n];
      for (const attr of ['src', 'data-src', 'data-flickity-lazyload', 'data-original']) {
        const value = img.getAttribute(attr);
        if (value) images.push(value);
      }
      const srcset = img.getAttribute('srcset') ?? img.getAttribute('data-srcset');
      if (srcset) {
        for (const entry of srcset.split(',')) {
          const url = entry.trim().split(/\s+/)[0];
          if (url) images.push(url);
        }
      }
    }

    out.push({
      id: card.getAttribute('data-id') ?? '',
      href: card.getAttribute('data-to-posting') ?? card.querySelector('a[href]')?.getAttribute('href') ?? '',
      price: text('[data-qa="POSTING_CARD_PRICE"]'),
      expenses: text('[data-qa="expensas"]'),
      location: text('[data-qa="POSTING_CARD_LOCATION"]'),
      features: list('[data-qa="POSTING_CARD_FEATURES"] span'),
      description: text('[data-qa="POSTING_CARD_DESCRIPTION"]'),
      images,
    });
  }

  return out;
}

/**
 * Feature chips are self-describing: "1360 m² tot.", "5 quartos", "5 ban.",
 * "13 vagas". Matching the noun rather than the position survives Navent adding
 * or reordering a chip.
 */
function feature(features: string[], pattern: RegExp): number {
  for (const value of features) {
    if (pattern.test(value)) return toInt(value);
  }
  return 0;
}

/**
 * Cards link the 360px thumbnail; the CDN takes any size in the path.
 * Measured on the same file:
 *
 *   /360x266/     360x266    19 kB
 *   /720x532/     720x532    62 kB
 *   /1200x1200/  1179x824   140 kB   <- used here (aspect is preserved)
 *
 * The `?isFirstImage=true` query is dropped too — it changes nothing about the
 * response and would otherwise be stored as part of the URL.
 */
function upgradeImage(url: string): string {
  return url.replace(/\/\d+x\d+\//, '/1200x1200/').split('?')[0];
}

/** "Jardim Everest, São Paulo" -> { neighborhood, city } */
function splitLocation(value: string, fallbackCity: string) {
  const parts = value
    .split(',')
    .map((p) => clean(p, 120))
    .filter(Boolean);
  if (parts.length >= 2) return { neighborhood: parts[0], city: parts[parts.length - 1] };
  return { neighborhood: parts[0] || fallbackCity, city: fallbackCity };
}

export function mapCard(card: Card, target: SearchTarget): RawListing | null {
  // The card's href carries per-request tracking parameters
  // (?n_src=Listado&n_pg=1&n_search_id=<random uuid>). Keeping them would make
  // source_url — a unique column — different on every single run for the same
  // listing. The path alone identifies the posting, so everything below uses it.
  const path = card.href.split('?')[0];

  const externalId = idText(card.id || path.match(/(\d{6,})\.html/)?.[1]);
  if (!externalId) return null;

  const rentPrice = toMoney(card.price);
  if (!rentPrice) return null;

  // An "aluguel" results page also carries promoted sale listings (and the other
  // way round). Their URL says which they are, so drop the ones that do not
  // match what this run is looking for rather than storing an R$ 850.000 "rent".
  const isSale = /-a-venda-|\/venda\//i.test(path);
  if (isSale !== (target.listingType === 'SALE')) return null;

  const sourceUrl = path.startsWith('http') ? path : `${ORIGIN}${path}`;
  const { neighborhood, city } = splitLocation(card.location, target.city);
  const description = clean(card.description, 2000);
  const bedrooms = feature(card.features, /quarto|dormit/i);

  // Navent's cards have no title element — only a long agency blurb. Using the
  // first 200 characters of that as a title produces unreadable cards, so a
  // title is composed from the URL slug (which is a real, human-written headline)
  // and falls back to the specs.
  const slugTitle = clean(
    path
      .replace(/^.*\/propriedades\//, '')
      .replace(/-?\d{6,}\.html.*$/, '')
      .split('-')
      .join(' '),
    200,
  );

  return {
    externalId,
    sourceUrl,
    title:
      (slugTitle ? slugTitle.charAt(0).toUpperCase() + slugTitle.slice(1) : '') ||
      `${bedrooms} quartos em ${neighborhood}`,
    description: description || null,
    address: neighborhood,
    neighborhood,
    city,
    state: target.state,
    rentPrice,
    // Navent calls the condo fee "expensas"; it is frequently blank.
    condoFee: toMoney(card.expenses),
    taxFee: 0,
    bedrooms,
    bathrooms: feature(card.features, /\bban\b|banheiro/i),
    parkingSpots: feature(card.features, /vaga|garagem|cochera/i),
    // "1360 m² tot." — the total-area chip is the only area chip on most cards.
    sqm: feature(card.features, /m²/i),
    // Only the ad CDN: a card also carries the agency's logo and Navent's own
    // artwork, and those are not photos of the flat.
    images: unique(
      card.images
        .map((i) => clean(i, 500))
        .filter((i) => /^https?:/.test(i) && /imovelwebcdn|navent/i.test(i) && !/logo|sprite|icon/i.test(i))
        .map(upgradeImage),
    ).slice(0, 12),
    amenities: [],
    petFriendly: detectPetPolicy(description),
    listingType: target.listingType,
  };
}

export const IMOVELWEB_CONFIG: PageParserConfig = {
  label: 'ImovelWeb',
  origin: ORIGIN,
  urls,
  async extract(page: Page, target: SearchTarget): Promise<RawListing[]> {
    const cards = await page.evaluate(readCards);
    return cards.map((card) => mapCard(card, target)).filter((l): l is RawListing => l !== null);
  },
};

export const imovelWebParser = buildPageParser('IMOVELWEB', IMOVELWEB_CONFIG);

