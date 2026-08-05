import type { Page } from 'playwright-core';
import { buildPageParser, type PageParserConfig } from './page.js';
import { clean, detectPetPolicy, idText, toInt, toMoney, unique } from './util.js';
import { toUf } from '../locations.js';
import type { RawListing, SearchTarget } from '../types.js';

/**
 * OLX.
 *
 * This parser used to read the `__NEXT_DATA__` hydration payload. That payload
 * no longer exists — the current search page carries nothing but ad-tech JSON
 * and a pair of schema.org blocks describing OLX itself, which is why the
 * parser was returning zero listings while the page answered 200.
 *
 * The listings are server-rendered as `section.olx-adcard`, so that is what is
 * read now. Two things make it less brittle than card scraping usually is:
 *
 *   - the specs come from `aria-label` ("1 quarto", "54 metros quadrados"),
 *     which exists for screen readers and therefore has a reason to stay stable;
 *   - the id comes from the trailing digits of the ad URL, not from markup.
 *
 * Verified against the live site. If it breaks, `make doctor` reports whether
 * the page loaded at all (bot wall) or loaded and yielded nothing (markup).
 */

const ORIGIN = 'https://www.olx.com.br';

/**
 * The regional path segment is simply the UF: `estado-pr`, `estado-sp`.
 *
 * The previous version kept a ten-state lookup table that fell back to
 * `estado-sp`, so a search for Curitiba was quietly performed in São Paulo.
 * There is no such fallback now: with no state we search nationally and say so.
 */
function urls(target: SearchTarget, pageNumber: number): string[] {
  const section = target.listingType === 'SALE' ? 'venda' : 'aluguel';
  const params = new URLSearchParams({ o: String(pageNumber) });
  if (target.minPrice) params.set('ps', String(target.minPrice));
  if (target.maxPrice) params.set('pe', String(target.maxPrice));

  if (!target.state) {
    const national = new URLSearchParams(params);
    national.set('q', target.city);
    return [`${ORIGIN}/imoveis/${section}?${national}`];
  }

  const uf = target.state.toLowerCase();
  return [
    `${ORIGIN}/imoveis/${section}/estado-${uf}/${target.citySlug}?${params}`,
    // Some cities sit under a region segment rather than their own slug.
    `${ORIGIN}/imoveis/${section}/estado-${uf}?${new URLSearchParams({ ...Object.fromEntries(params), q: target.city })}`,
  ];
}

/** One card as read from the DOM. Everything is a string; parsing happens below. */
type Card = {
  href: string;
  title: string;
  price: string;
  location: string;
  /** aria-labels of the spec chips, e.g. ["54 metros quadrados", "1 quarto"]. */
  details: string[];
  /** Extra price lines, e.g. ["Condomínio R$ 500", "IPTU R$ 90"]. */
  priceInfo: string[];
  image: string;
};

/** Runs in the page. Returns plain data so all parsing stays in typed Node code. */
function readCards(): Card[] {
  const scope = globalThis as unknown as {
    document: {
      querySelectorAll: (s: string) => ArrayLike<Element>;
    };
  };
  type Element = {
    querySelector: (s: string) => Element | null;
    querySelectorAll: (s: string) => ArrayLike<Element>;
    getAttribute: (name: string) => string | null;
    textContent: string | null;
  };

  const cards = scope.document.querySelectorAll('section.olx-adcard, section[class*="adcard"]');
  const out: Card[] = [];

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    const text = (selector: string) => card.querySelector(selector)?.textContent?.trim() ?? '';
    const all = (selector: string) => {
      const nodes = card.querySelectorAll(selector);
      const values: Element[] = [];
      for (let n = 0; n < nodes.length; n += 1) values.push(nodes[n]);
      return values;
    };

    const link = card.querySelector('a[data-testid="adcard-link"]') ?? card.querySelector('a[href]');

    out.push({
      href: link?.getAttribute('href') ?? '',
      title: text('.olx-adcard__title') || link?.getAttribute('title') || '',
      price: text('.olx-adcard__price'),
      location: text('.olx-adcard__location'),
      details: all('.olx-adcard__detail').map(
        (d) => d.getAttribute('aria-label') ?? d.textContent?.trim() ?? '',
      ),
      priceInfo: all('.olx-adcard__price-info-list *').map((e) => e.textContent?.trim() ?? ''),
      image: card.querySelector('img')?.getAttribute('src') ?? '',
    });
  }

  return out;
}

/** The ad id is the trailing number of the ad URL. */
function idFromHref(href: string): string {
  const match = href.match(/(\d{6,})(?:[/?#]|$)/);
  return match ? match[1] : '';
}

/**
 * Spec chips carry a screen-reader label: "54 metros quadrados", "2 quartos",
 * "1 vaga de garagem". Matching on the noun is more durable than relying on the
 * chips arriving in a fixed order.
 */
function spec(details: string[], pattern: RegExp): number {
  for (const detail of details) {
    if (pattern.test(detail)) return toInt(detail);
  }
  return 0;
}

/**
 * OLX writes a card's location in two different formats depending on which
 * results page it came from:
 *
 *   "Santos, Boqueirão"       city, neighborhood      (regional results)
 *   "Curitiba - PR"           city and UF             (national results)
 *   "Curitiba - PR, Centro"   both                    (occasionally)
 *
 * The " - UF" suffix has to be stripped, or the city reads as "Curitiba - PR",
 * whose slug is `curitiba-pr` and matches no target — every listing gets dropped
 * by the city guard even though it is the right city. The UF is worth keeping:
 * on a national search it is the only place the state is stated.
 */
function splitLocation(value: string, fallbackCity: string) {
  const parts = value
    .split(',')
    .map((p) => clean(p, 120))
    .filter(Boolean);

  let city = parts[0] || fallbackCity;
  let uf: string | null = null;

  const suffix = city.match(/^(.*?)\s*-\s*([A-Za-z]{2})$/);
  if (suffix) {
    const parsed = toUf(suffix[2]);
    if (parsed) {
      city = clean(suffix[1], 120) || fallbackCity;
      uf = parsed;
    }
  }

  const neighborhood = parts.length >= 2 ? parts.slice(1).join(', ') : city;
  return { city, neighborhood, uf };
}

/** Pulls "Condomínio R$ 500" style extras out of the price block. */
function priceExtra(lines: string[], pattern: RegExp): number {
  for (const line of lines) {
    if (pattern.test(line)) return toMoney(line);
  }
  return 0;
}

export function mapCard(card: Card, target: SearchTarget): RawListing | null {
  const externalId = idText(idFromHref(card.href));
  if (!externalId) return null;

  const rentPrice = toMoney(card.price);
  if (!rentPrice) return null;

  const sourceUrl = card.href.startsWith('http') ? card.href : `${ORIGIN}${card.href}`;
  const { city, neighborhood, uf } = splitLocation(card.location, target.city);
  const title = clean(card.title, 200);

  return {
    externalId,
    sourceUrl,
    title: title || `Imóvel em ${neighborhood}`,
    // The card shows no description; the title is the only prose available and
    // is what the pet-policy heuristic has to work from.
    description: null,
    address: neighborhood,
    neighborhood,
    city,
    // The card's own UF wins: on a national search it is the only source of it.
    state: uf ?? target.state,
    rentPrice,
    condoFee: priceExtra(card.priceInfo, /condom/i),
    taxFee: priceExtra(card.priceInfo, /iptu/i),
    bedrooms: spec(card.details, /quarto|dormit/i),
    bathrooms: spec(card.details, /banheiro/i),
    parkingSpots: spec(card.details, /vaga|garagem/i),
    sqm: spec(card.details, /metros quadrados|m²/i),
    images: unique([clean(card.image, 500)].filter(Boolean)),
    amenities: [],
    petFriendly: detectPetPolicy(title),
    listingType: target.listingType,
  };
}

export const OLX_CONFIG: PageParserConfig = {
  label: 'OLX',
  origin: ORIGIN,
  urls,
  async extract(page: Page, target: SearchTarget): Promise<RawListing[]> {
    const cards = await page.evaluate(readCards);
    return cards.map((card) => mapCard(card, target)).filter((l): l is RawListing => l !== null);
  },
};

export const olxParser = buildPageParser('OLX', OLX_CONFIG);

