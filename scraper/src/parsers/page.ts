import type { Page } from 'playwright-core';
import type { Parser, RawListing, ScrapeContext, SearchTarget } from '../types.js';
import { applyTargetFilters } from './util.js';

/**
 * Shared machinery for the portals that have no usable JSON API, where the only
 * way in is to load the search page and read what it renders.
 *
 * Each portal differs in WHERE the data lives, and the difference is not a
 * detail — it is the whole parser:
 *
 *   OLX            server-rendered cards. It used to embed __NEXT_DATA__; that
 *                  is gone, and the page now carries nothing but ad-tech JSON.
 *   ImovelWeb      server-rendered cards with `data-qa` test hooks. Its
 *                  schema.org blocks exist but omit the price, so they are
 *                  useless on their own.
 *   Chaves na Mão  a complete schema.org Offer list, which is the nicest of the
 *                  three: it is published for search engines, so it changes far
 *                  less often than the markup around it.
 *
 * So this module owns navigation, URL-scheme fallbacks, pagination and error
 * reporting, and each portal supplies its own `extract`.
 */

export type PageParserConfig = {
  label: string;
  origin: string;
  /**
   * Candidate URLs for one page of results, most-likely first. Portals rename
   * their URL schemes, so the first that returns records wins and is remembered.
   */
  urls: (target: SearchTarget, page: number) => string[];
  /**
   * Set when the portal's URL scheme cannot be built without a UF, so there is
   * no such thing as a state-less search. Chaves na Mão is the case: its path is
   * `/imoveis-para-alugar/{uf}-{cidade}/` and dropping the UF gives a page that
   * answers 200 with no offers on it. Without this flag that is indistinguishable
   * from "the structured data moved", and the doctor blames the wrong thing.
   */
  requiresState?: boolean;
  /** Pulls listings out of a loaded page. Runs once per result page. */
  extract: (page: Page, target: SearchTarget) => Promise<RawListing[]>;
};

/**
 * Every JSON blob a page carries, parsed.
 *
 * Kept here because it is worth trying on any portal: frameworks hydrate from
 * one of these globals, and schema.org data lives in the script tags.
 */
const PAYLOAD_GLOBALS = [
  '__NEXT_DATA__',
  '__NUXT__',
  '__PRELOADED_STATE__',
  '__INITIAL_STATE__',
  '__APOLLO_STATE__',
  '__remixContext',
];

export async function collectPayloads(page: Page): Promise<unknown[]> {
  const raw = await page.evaluate((globals: string[]): string[] => {
    const scope = globalThis as unknown as {
      document: { querySelectorAll: (selector: string) => ArrayLike<{ textContent: string | null }> };
    } & Record<string, unknown>;

    const out: string[] = [];
    const push = (value: unknown) => {
      if (value === null || value === undefined) return;
      try {
        out.push(typeof value === 'string' ? value : JSON.stringify(value));
      } catch {
        // Circular or otherwise unserialisable — nothing we can use.
      }
    };

    for (const name of globals) push(scope[name]);

    const nodes = scope.document.querySelectorAll(
      'script[type="application/json"], script[type="application/ld+json"]',
    );
    for (let i = 0; i < nodes.length; i += 1) push(nodes[i].textContent);

    return out;
  }, PAYLOAD_GLOBALS);

  const payloads: unknown[] = [];
  for (const text of raw) {
    try {
      payloads.push(JSON.parse(text) as unknown);
    } catch {
      // Not JSON (Nuxt sometimes inlines a function call) — skip it.
    }
  }
  return payloads;
}

/**
 * Builds a parser that walks result pages, extracting listings from each.
 *
 * Pagination stops on the first page that yields nothing, so a portal that
 * silently repeats page 1 forever cannot spin the run out.
 */
export function buildPageParser(source: Parser['source'], config: PageParserConfig): Parser {
  return {
    source,
    label: config.label,

    async search(target: SearchTarget, ctx: ScrapeContext): Promise<RawListing[]> {
      if (config.requiresState && !target.state) {
        throw new Error(
          `${config.label} scopes every search by state and cannot be searched without one — ` +
            `set a state for ${target.city} in Preferences`,
        );
      }

      const page = await ctx.newPage();
      page.setDefaultNavigationTimeout(45_000);

      const results: RawListing[] = [];
      const seen = new Set<string>();
      let reachedAPage = false;
      // Remembered across result pages: no point re-testing dead URL shapes.
      let urlIndex = 0;

      try {
        for (let pageNumber = 1; pageNumber <= ctx.maxPages; pageNumber += 1) {
          const candidates = config.urls(target, pageNumber);
          let listings: RawListing[] = [];

          for (let attempt = 0; attempt < candidates.length; attempt += 1) {
            const index = (urlIndex + attempt) % candidates.length;
            const url = candidates[index];

            ctx.log.debug(`${url}`);
            const response = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
            const status = response?.status() ?? 0;

            if (status === 0 || status >= 400) {
              ctx.log.debug(`${url} returned ${status || 'no response'}`);
              continue;
            }
            reachedAPage = true;

            listings = await config.extract(page, target);
            if (listings.length > 0) {
              if (index !== urlIndex) {
                ctx.log.info(`URL scheme changed, using ${url}`);
                urlIndex = index;
              }
              break;
            }
            ctx.log.debug(`${url} loaded but no listing could be read from it`);
          }

          if (listings.length === 0) break;

          // Portals pad later pages with repeats of page 1. Counting only new
          // ids means a portal that ignores the page parameter stops the loop
          // instead of re-reporting the same listings on every pass.
          let fresh = 0;
          for (const listing of listings) {
            if (seen.has(listing.externalId)) continue;
            seen.add(listing.externalId);
            results.push(listing);
            fresh += 1;
          }
          if (fresh === 0) {
            ctx.log.debug('page repeated earlier results — stopping pagination');
            break;
          }

          await ctx.delay();
        }
      } finally {
        await page.close().catch(() => undefined);
      }

      // Being turned away is a failure and should be recorded as one. Returning
      // an empty list quietly is what makes a broken parser look like a slow
      // week on the market.
      if (results.length === 0) {
        throw new Error(
          reachedAPage
            ? `${config.label} served pages but no listing could be read — the markup changed (run \`make doctor\`)`
            : `${config.label} did not serve a usable page — bot wall, or the URL scheme moved`,
        );
      }

      return applyTargetFilters(results, target);
    },
  };
}
