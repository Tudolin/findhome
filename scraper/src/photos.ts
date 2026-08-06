import type { Page } from 'playwright-core';
import type { Prisma, PropertySource } from '@prisma/client';
import { BrowserPool, sleep } from './browser.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';

const log = logger('photos');

/**
 * Gallery backfill: opens a listing's own page and collects every photo on it.
 *
 * ## Why this exists
 *
 * Only half the portals publish a full gallery in their search results:
 *
 *   ZAP / Viva Real   `listing.images[]`         every photo        ✔
 *   QuintoAndar       `coverImage` + `imageList` every photo        ✔
 *   OLX               the card's `<img>`         the cover, only    ✘
 *   Chaves na Mão     schema.org `item.image`    the cover, only    ✘
 *   ImovelWeb         the card's `<img>`         the cover; the carousel is
 *                                                lazy-loaded and never renders
 *                                                on a results page             ✘
 *
 * That is not a parser bug — those portals genuinely do not put the gallery in
 * their search response. There is nowhere to read it from except the listing's
 * own page, which is one navigation per listing and therefore cannot happen
 * inline with the search. So it is a second pass, shaped exactly like the
 * geocoder: bounded per run, stamped so nothing is retried forever, and never
 * allowed to fail the scrape.
 *
 * ## How photos are found
 *
 * Four strategies, in descending order of how stable they are, and all of them
 * are run — a portal that publishes both JSON-LD and a carousel gives more
 * photos when you read both:
 *
 *   1. schema.org `image` / `ImageObject.contentUrl` in ld+json. Published for
 *      search engines, so it survives redesigns.
 *   2. Hydration payloads (`__NEXT_DATA__` and friends): any string that looks
 *      like a photo URL from the portal's own image CDN.
 *   3. `<meta property="og:image">`, which a listing page usually repeats per
 *      photo.
 *   4. The DOM: `<img src|data-src|srcset>` and `<source srcset>`, plus
 *      `<link rel=preload as=image>`. Last because it is the most fragile.
 *
 * Everything is then filtered (icons, logos, sprites, avatars and tracking
 * pixels are not listing photos) and passed through the same size upgrades the
 * parsers apply, so a backfilled photo is the same resolution as a scraped one.
 */

const ENABLED = (process.env.PHOTOS_ENABLED ?? 'true').toLowerCase() !== 'false';
/** Listings per run. The pass costs one page load each, so this is the budget. */
const MAX_PER_RUN = Math.max(0, Number(process.env.PHOTOS_MAX_PER_RUN ?? 60));
/** A listing with at least this many photos is left alone. */
const MIN_IMAGES = Math.max(1, Number(process.env.PHOTOS_MIN_IMAGES ?? 3));
/** Politeness delay between listing pages. */
const DELAY_MS = Math.max(250, Number(process.env.PHOTOS_DELAY_MS ?? 1200));
/** Cap per listing, matching what `persistListings` stores. */
const MAX_PHOTOS = 15;
const NAV_TIMEOUT_MS = Math.max(10_000, Number(process.env.PHOTOS_TIMEOUT_MS ?? 30_000));

/**
 * Sources whose search response already carries the gallery. Skipped by default
 * so the budget goes to the listings that actually need it.
 */
const COMPLETE_AT_SEARCH: PropertySource[] = ['ZAP', 'VIVA_REAL', 'QUINTO_ANDAR', 'DEMO', 'MANUAL'];

/** Anything matching this is chrome, not a photo of a flat. */
const NOT_A_PHOTO =
  /(sprite|logo|icon|favicon|avatar|placeholder|blank|pixel|beacon|badge|watermark|whatsapp|facebook|instagram|googletag|doubleclick|analytics|1x1|spacer)/i;

const LOOKS_LIKE_IMAGE = /\.(jpe?g|png|webp|avif)(\?|#|$)/i;

/**
 * Image hosts the portals serve listing photos from.
 *
 * A listing page also links the agency's logo, the portal's own artwork and
 * whatever the ad network injected. Requiring a known photo host is what keeps
 * those out — an allowlist fails closed (a moved CDN yields no photos and the
 * count is 0, which shows up in the log) rather than filling the carousel with
 * banner ads.
 */
const PHOTO_HOSTS = [
  'olx.com.br',
  'olxbr.io',
  'olxstatic.com',
  'imovelwebcdn.com',
  'navent.com',
  'chavesnamao.com.br',
  'cnmimoveis.com.br',
  'quintoandar.com.br',
  'zapimoveis.com.br',
  'vivareal.com.br',
  'resizedimgs.',
  'cloudfront.net',
  'akamaized.net',
];

/**
 * Same size upgrades the parsers apply, in one place so a backfilled photo is
 * never the small variant. Each was measured against the live CDN — see the
 * comments in the individual parsers and the 20260805040000 migration.
 */
function upgrade(url: string): string {
  return url
    .replace(/\/thumbs\d+x\d+\//, '/images/')
    .replace(/\/img\/(med|small|thumb)\//, '/img/xxl/')
    .replace(/\/imn\/\d+X\d+\//i, '/imn/1600X1200/')
    .replace(/(imgbr\.imovelwebcdn\.com\/[^?]*?)\/\d+x\d+\//, '$1/1200x1200/')
    .replace('{action}', 'fit-in')
    .replace('{width}x{height}', '800x600');
}

function keep(url: string): boolean {
  if (!url.startsWith('http')) return false;
  if (url.length > 500) return false;
  if (NOT_A_PHOTO.test(url)) return false;
  if (!PHOTO_HOSTS.some((host) => url.includes(host))) return false;
  // A query string is normal on these CDNs, so the extension check is a hint
  // rather than a requirement — but a URL with neither is almost never a photo.
  return LOOKS_LIKE_IMAGE.test(url) || /\/(images?|fotos?|imn|img|thumbs)\//i.test(url);
}

/**
 * Runs inside the page. Returns raw candidate URLs; every decision about what to
 * keep stays in typed Node code above.
 *
 * Written against a locally typed `globalThis` because the scraper's tsconfig
 * has no DOM lib on purpose — it is a Node service, and pulling the whole DOM
 * surface in for one function is not worth it (same approach as http.ts).
 */
function readGallery(): string[] {
  type El = {
    getAttribute: (name: string) => string | null;
    textContent: string | null;
  };
  const scope = globalThis as unknown as {
    document: { querySelectorAll: (selector: string) => ArrayLike<El> };
  } & Record<string, unknown>;

  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.length > 8) out.push(value);
  };

  const each = (selector: string, read: (el: El) => void) => {
    const nodes = scope.document.querySelectorAll(selector);
    for (let i = 0; i < nodes.length; i += 1) read(nodes[i]);
  };

  // --- 1. schema.org, and 2. hydration payloads -----------------------------
  // Both are JSON, so they are walked the same way: collect every string in the
  // tree. Filtering happens in Node, which means a renamed field costs nothing.
  const walk = (node: unknown, depth: number) => {
    if (depth > 10 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === 'string') push(item);
        else walk(item, depth + 1);
      }
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (typeof value === 'string') push(value);
      else walk(value, depth + 1);
    }
  };

  for (const name of ['__NEXT_DATA__', '__NUXT__', '__PRELOADED_STATE__', '__INITIAL_STATE__', '__APOLLO_STATE__']) {
    try {
      walk(scope[name], 0);
    } catch {
      // Circular or exotic — nothing usable.
    }
  }

  each('script[type="application/ld+json"], script[type="application/json"]', (el) => {
    try {
      walk(JSON.parse(el.textContent ?? 'null'), 0);
    } catch {
      // Not JSON.
    }
  });

  // --- 3. Open Graph --------------------------------------------------------
  each('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]', (el) =>
    push(el.getAttribute('content')),
  );

  // --- 4. The DOM -----------------------------------------------------------
  const fromSrcset = (value: string | null) => {
    if (!value) return;
    // "url 1x, url 2x" / "url 320w, url 640w" — take every URL, the largest
    // wins later because they normalise to the same upgraded path.
    for (const part of value.split(',')) push(part.trim().split(/\s+/)[0]);
  };

  each('img', (el) => {
    push(el.getAttribute('src'));
    push(el.getAttribute('data-src'));
    push(el.getAttribute('data-lazy-src'));
    push(el.getAttribute('data-original'));
    fromSrcset(el.getAttribute('srcset'));
    fromSrcset(el.getAttribute('data-srcset'));
  });

  each('source', (el) => fromSrcset(el.getAttribute('srcset')));
  each('link[rel="preload"][as="image"]', (el) => push(el.getAttribute('href')));

  return out;
}

/**
 * Nudges a lazy carousel into loading. Most of these galleries render their
 * remaining photos only once the strip is scrolled or a thumbnail is clicked, so
 * a plain `goto` sees exactly the one photo the results page already gave us.
 *
 * Worth knowing: BrowserPool aborts every image request (see browser.ts), so no
 * photo is ever downloaded here — the pass reads `src` / `srcset` attributes, not
 * bytes. That is why it costs a page load rather than a gallery's worth of
 * traffic, and it is also why `data-src` matters: a loader whose request was
 * aborted may never promote its URL into `src`.
 *
 * Deliberately best-effort and short: this is a nice-to-have on top of the JSON
 * strategies, not something worth spending seconds per listing on.
 */
async function coaxLazyImages(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const scope = globalThis as unknown as {
        scrollTo: (x: number, y: number) => void;
        document: { body: { scrollHeight: number } };
        setTimeout: (fn: () => void, ms: number) => void;
      };
      for (let i = 1; i <= 4; i += 1) {
        scope.scrollTo(0, (scope.document.body.scrollHeight / 4) * i);
        await new Promise<void>((resolve) => scope.setTimeout(resolve, 250));
      }
      scope.scrollTo(0, 0);
    })
    .catch(() => undefined);
}

type Candidate = {
  id: string;
  source: PropertySource;
  sourceUrl: string;
  images: string[];
};

/**
 * Identity of a photo, ignoring the query string — the same rule as
 * `photoKey` in persist.ts, and for the same reason: these CDNs decorate one file
 * with per-request parameters, so comparing full URLs stores the same photo three
 * times and fills the carousel with duplicates.
 */
const photoKey = (url: string) => url.split('?')[0].split('#')[0];

/** Merge: whatever the search gave us first, then everything new, order kept. */
function merge(existing: string[], found: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...existing.map(upgrade), ...found]) {
    const key = photoKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

async function fetchGallery(page: Page, candidate: Candidate): Promise<string[] | null> {
  const response = await page
    .goto(candidate.sourceUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
    .catch(() => null);

  const status = response?.status() ?? 0;
  // A dead listing (404/410) or a bot wall (403) is not something to retry on
  // the next run either — the stamp goes on regardless, and the count of 0 says
  // what happened. Distinguishing them is what the log line is for.
  if (status === 0 || status >= 400) {
    log.debug(`${candidate.sourceUrl} returned ${status || 'no response'}`);
    return null;
  }

  await coaxLazyImages(page);

  const raw = await page.evaluate(readGallery).catch(() => [] as string[]);
  const found: string[] = [];
  const seen = new Set<string>();

  for (const url of raw) {
    // Protocol-relative URLs are common in hydration payloads.
    const absolute = url.startsWith('//') ? `https:${url}` : url;
    if (!keep(absolute)) continue;
    const upgraded = upgrade(absolute);
    const key = photoKey(upgraded);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(upgraded);
    if (found.length >= MAX_PHOTOS * 2) break;
  }

  return found;
}

/**
 * Fills in galleries for listings the search results only gave a cover photo
 * for.
 *
 * Never throws: called from `runScrape` after the catalogue is written, and a
 * portal that refuses a listing page is not a failed scrape.
 */
export async function backfillPhotos(browsers: BrowserPool): Promise<void> {
  if (!ENABLED || MAX_PER_RUN === 0) return;

  const where: Prisma.PropertyWhereInput = {
    active: true,
    // Never asked before. The stamp is what stops a listing whose page genuinely
    // has one photo from being re-opened on every single run.
    photosFetchedAt: null,
    photoCount: { lt: MIN_IMAGES },
    source: { notIn: COMPLETE_AT_SEARCH },
  };

  const [pending, remaining] = await Promise.all([
    prisma.property.findMany({
      where,
      // Newest first: those are the ones somebody is about to open.
      orderBy: { createdAt: 'desc' },
      take: MAX_PER_RUN,
      select: { id: true, source: true, sourceUrl: true, images: true },
    }),
    prisma.property.count({ where }),
  ]);

  if (pending.length === 0) return;
  log.info(`fetching galleries for ${pending.length} of ${remaining} listing(s) with only a cover photo`);

  const page = await browsers.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  let improved = 0;
  let added = 0;
  let empty = 0;
  let unreachable = 0;

  try {
    for (const candidate of pending) {
      const found = await fetchGallery(page, candidate);

      if (found === null) {
        unreachable += 1;
        // Stamped anyway — see the note in fetchGallery. photoCount keeps
        // whatever the search found, so the cover photo is not lost.
        await prisma.property.update({
          where: { id: candidate.id },
          data: { photosFetchedAt: new Date() },
        });
        await sleep(DELAY_MS);
        continue;
      }

      const images = merge(candidate.images, found);
      const gained = images.length - candidate.images.length;

      await prisma.property.update({
        where: { id: candidate.id },
        data: { images, photoCount: images.length, photosFetchedAt: new Date() },
      });

      if (gained > 0) {
        improved += 1;
        added += gained;
      } else {
        empty += 1;
      }

      await sleep(DELAY_MS);
    }
  } finally {
    await page.close().catch(() => undefined);
  }

  log.info(
    `galleries: ${improved} listing(s) gained ${added} photo(s), ` +
      `${empty} had nothing more to give, ${unreachable} page(s) could not be read`,
  );

  if (remaining > pending.length) {
    const runsLeft = Math.ceil((remaining - pending.length) / MAX_PER_RUN);
    log.info(`${remaining - pending.length} still pending — about ${runsLeft} more run(s) at this rate`);
  }

  // A pass that improves nothing at all is worth saying out loud: it means every
  // strategy missed, which is a markup change rather than a quiet week.
  if (improved === 0 && unreachable < pending.length) {
    log.warn(
      'no listing gained a photo. Either these listings really do have one photo each, or the ' +
        'gallery moved — open one of the sourceUrls in a browser and check. PHOTOS_ENABLED=false turns this pass off.',
    );
  }
}

/** Exposed so the doctor can report why carousels might be one photo long. */
export const PHOTOS_STATUS = {
  enabled: ENABLED,
  maxPerRun: MAX_PER_RUN,
  minImages: MIN_IMAGES,
  delayMs: DELAY_MS,
  skipsSources: COMPLETE_AT_SEARCH,
  timezone: config.timezone,
};
