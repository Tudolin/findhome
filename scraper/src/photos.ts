import type { Page, Route } from 'playwright-core';
import type { Prisma, PropertySource } from '@prisma/client';
import { BrowserPool, sleep } from './browser.js';
import { markGone } from './cleanup.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { syncPhotoRows } from './media.js';

const log = logger('photos');

/**
 * Gallery backfill: opens a listing's own page and collects every photo on it.
 *
 * ## Why this exists
 *
 * No portal puts its full gallery in a search response, and three of them put
 * exactly one photo there:
 *
 *   ZAP / Viva Real   `listing.images[]`         a few, rarely all
 *   QuintoAndar       `coverImage` + `imageList` a few, rarely all
 *   OLX               the card's `<img>`         the cover, only
 *   Chaves na Mão     schema.org `item.image`    the cover, only
 *   ImovelWeb         the card's `<img>`         the cover; the carousel is
 *                                                lazy-loaded and never renders
 *                                                on a results page
 *
 * The rest only exists on the listing's own page, which is one navigation per
 * listing and therefore cannot happen inline with the search. So it is a second
 * pass, shaped like the geocoder: bounded per run, stamped so nothing is retried
 * forever, and never allowed to fail the scrape.
 *
 * ## Three things make it find photos the naive version missed
 *
 * 1. **Image requests are answered with a 1×1 stub instead of being aborted.**
 *    `BrowserPool` blocks images to save bandwidth, which is right for a search
 *    page — but a carousel that appends its next slide in an `onload` handler
 *    stops dead when the first image fails. A stub costs 43 bytes, fires `load`,
 *    and lets the lazy chain run to the end. This is the single biggest reason
 *    galleries came back short.
 * 2. **The URL filter fails open, not closed.** It was an allowlist of image
 *    hosts, which silently dropped every photo the moment a portal moved to a new
 *    CDN (`resizedimgs.vivareal.com` is not `vivareal.com.br`). Now it rejects
 *    known junk and accepts anything that looks like a photo.
 * 3. **Every source is visited**, not just the three with a one-photo search
 *    response — ZAP and QuintoAndar return a handful, not the whole album.
 *
 * ## How photos are found
 *
 * Four strategies, all of them run, in descending order of durability:
 *
 *   1. schema.org `image` / `ImageObject.contentUrl` in ld+json. Published for
 *      search engines, so it survives redesigns.
 *   2. Hydration payloads (`__NEXT_DATA__` and friends).
 *   3. `<meta property="og:image">`.
 *   4. The DOM: `<img src|data-*|srcset>`, `<source srcset>`, CSS
 *      `background-image`, and `<link rel=preload as=image>`.
 */

const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined || value.trim() === '' ? fallback : value.toLowerCase() === 'true';

const int = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ENABLED = bool(process.env.PHOTOS_ENABLED, true);
/** Listings per run. The pass costs one page load each, so this is the budget. */
const MAX_PER_RUN = Math.max(0, int(process.env.PHOTOS_MAX_PER_RUN, 200));
/**
 * Skip listings that already have at least this many photos.
 *
 * **0 (the default) means no gate: every listing gets its page opened once.**
 * The old default of 3 was the second reason galleries stayed short — a listing
 * whose search response happened to carry three photos was never visited, so its
 * other twenty were never found.
 */
const MIN_IMAGES = Math.max(0, int(process.env.PHOTOS_MIN_IMAGES, 0));
/** Politeness delay between listing pages. */
const DELAY_MS = Math.max(200, int(process.env.PHOTOS_DELAY_MS, 900));
/** Photos stored per listing. 0 = no limit, which is the default. */
export const MAX_PHOTOS = Math.max(0, int(process.env.PHOTOS_MAX_PER_LISTING, 0));
const NAV_TIMEOUT_MS = Math.max(10_000, int(process.env.PHOTOS_TIMEOUT_MS, 30_000));
/** How long to let a lazy carousel finish after the scroll. */
const SETTLE_MS = Math.max(0, int(process.env.PHOTOS_SETTLE_MS, 1200));

/** Applies MAX_PHOTOS, treating 0 as "no limit". */
export const capPhotos = <T>(values: T[]): T[] => (MAX_PHOTOS > 0 ? values.slice(0, MAX_PHOTOS) : values);

/**
 * Sources with no listing page to open. Everything else is visited — including
 * ZAP, Viva Real and QuintoAndar, whose search responses carry a few photos but
 * never the whole album.
 */
const NO_LISTING_PAGE: PropertySource[] = ['DEMO', 'MANUAL'];

/**
 * A transparent 1×1 GIF. Served in place of every image the listing page asks
 * for: `load` fires, lazy carousels advance, and nothing is downloaded.
 */
const STUB_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Third parties that serve pixels and ads, never photos of a flat. */
const JUNK_HOST =
  /(doubleclick|googlesyndication|googletagmanager|google-analytics|gstatic|adservice|adsystem|criteo|taboola|outbrain|hotjar|segment\.(io|com)|amplitude|newrelic|sentry|cloudflareinsights|scorecardresearch|clarity\.ms|facebook\.com|fbcdn|connect\.facebook)/i;

/** Filenames that are chrome, not content. */
const JUNK_PATH =
  /(sprite|logo|favicon|avatar|placeholder|blank|pixel|beacon|badge|watermark|banner|button|loading|spinner|spacer|social|whatsapp|share|flag|arrow|chevron|\bicons?\b|1x1|transparent)/i;

/**
 * Known photo CDNs. This is now a *bonus* signal rather than a requirement — see
 * point 2 in the header. A URL from one of these is kept even without an image
 * extension; a URL from anywhere else still qualifies if it looks like a photo.
 */
const PHOTO_HOSTS = [
  'olx.com.br',
  'olxbr.io',
  'olxstatic.com',
  'olxcdn.com',
  'imovelwebcdn.com',
  'navent.com',
  'chavesnamao.com.br',
  'cnmimoveis.com.br',
  'quintoandar.com.br',
  'zapimoveis.com.br',
  'vivareal.com',
  'resizedimgs.',
  'cloudfront.net',
  'akamaized.net',
  'imgix.net',
  'twiccpics.com',
];

const IMAGE_EXT = /\.(jpe?g|png|webp|avif)(\?|#|$)/i;
const MEDIA_PATH = /\/(images?|imagens|fotos?|foto|imn|img|media|photos?|thumbs?|resize[dr]?|fit-in|uploads?)\//i;

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
  if (!/^https?:\/\//i.test(url)) return false;
  if (url.length > 800) return false;
  // An SVG is a logo or an icon on every one of these sites.
  if (/\.svg(\?|#|$)/i.test(url)) return false;
  if (JUNK_HOST.test(url)) return false;
  if (JUNK_PATH.test(url)) return false;

  return IMAGE_EXT.test(url) || PHOTO_HOSTS.some((host) => url.includes(host)) || MEDIA_PATH.test(url);
}

/**
 * Identity of a photo, ignoring the query string — the same rule as `photoKey`
 * in persist.ts, and for the same reason: these CDNs decorate one file with
 * per-request parameters, so comparing full URLs stores the same photo three
 * times and fills the carousel with duplicates.
 */
const photoKey = (url: string) => url.split('?')[0].split('#')[0];

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
    getAttributeNames?: () => string[];
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
    if (depth > 12 || node === null || typeof node !== 'object') return;
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
    // "url 1x, url 2x" / "url 320w, url 640w" — take every URL; they normalise
    // to the same upgraded path anyway.
    for (const part of value.split(',')) push(part.trim().split(/\s+/)[0]);
  };

  each('img', (el) => {
    push(el.getAttribute('src'));
    fromSrcset(el.getAttribute('srcset'));
    // Lazy loaders park the real URL in a data-* attribute whose name nobody
    // agrees on (data-src, data-lazy, data-flickity-lazyload, data-echo…).
    // Reading them all is cheaper than tracking six libraries' conventions.
    const names = el.getAttributeNames?.() ?? [];
    for (const name of names) {
      if (!name.startsWith('data-')) continue;
      const value = el.getAttribute(name);
      if (!value) continue;
      if (name.includes('srcset')) fromSrcset(value);
      else if (/^https?:|^\/\//.test(value)) push(value);
    }
  });

  each('source', (el) => {
    fromSrcset(el.getAttribute('srcset'));
    push(el.getAttribute('src'));
  });

  each('link[rel="preload"][as="image"], link[rel="image_src"]', (el) => push(el.getAttribute('href')));

  // Galleries built as divs with a CSS background rather than <img>.
  each('[style*="background-image"]', (el) => {
    const style = el.getAttribute('style') ?? '';
    const match = style.match(/url\((['"]?)(.*?)\1\)/);
    if (match) push(match[2]);
  });

  return out;
}

/**
 * Nudges a lazy carousel into loading.
 *
 * Most of these galleries render their remaining photos only once the strip is
 * scrolled, so a plain `goto` sees exactly the one photo the results page
 * already gave us. Scrolling the page and then any horizontal strip on it is
 * what makes the rest materialise.
 *
 * Best-effort throughout: this is a nice-to-have on top of the JSON strategies,
 * and a page that does not cooperate must not cost more than a second.
 */
async function coaxLazyImages(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const scope = globalThis as unknown as {
        scrollTo: (x: number, y: number) => void;
        document: {
          body: { scrollHeight: number };
          querySelectorAll: (s: string) => ArrayLike<{ scrollLeft: number; scrollWidth: number }>;
        };
        setTimeout: (fn: () => void, ms: number) => void;
      };
      const wait = (ms: number) => new Promise<void>((resolve) => scope.setTimeout(resolve, ms));

      // Down the page, so anything below the fold enters the viewport.
      for (let i = 1; i <= 6; i += 1) {
        scope.scrollTo(0, (scope.document.body.scrollHeight / 6) * i);
        await wait(160);
      }
      scope.scrollTo(0, 0);

      // Then along every horizontal strip: a thumbnail rail is its own scroll
      // container, and scrolling the page does not move it.
      const strips = scope.document.querySelectorAll('[class*="carousel"], [class*="gallery"], [class*="slider"], [class*="thumb"]');
      for (let i = 0; i < strips.length && i < 12; i += 1) {
        const strip = strips[i];
        if (!strip || typeof strip.scrollWidth !== 'number') continue;
        for (let step = 1; step <= 4; step += 1) {
          strip.scrollLeft = (strip.scrollWidth / 4) * step;
          await wait(90);
        }
      }
    })
    .catch(() => undefined);
}

type Candidate = {
  id: string;
  source: PropertySource;
  sourceUrl: string;
  images: string[];
};

/** Merge: whatever the search gave us first, then everything new, order kept. */
function merge(existing: string[], found: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...existing.map(upgrade), ...found]) {
    const key = photoKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return capPhotos(out);
}

/** What the listing page told us, beyond the photos. */
type GalleryOutcome =
  | { kind: 'ok'; images: string[] }
  /** The ad is down: 404/410. Direct evidence, not a guess from absence. */
  | { kind: 'gone'; status: number }
  /** Refused or unreachable. Says nothing about whether the ad still exists. */
  | { kind: 'unreachable'; status: number };

async function fetchGallery(page: Page, candidate: Candidate): Promise<GalleryOutcome> {
  const response = await page
    .goto(candidate.sourceUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
    .catch(() => null);

  const status = response?.status() ?? 0;

  /**
   * 404 and 410 mean the ad was taken down — the portal is telling us so
   * directly, which is worth acting on today rather than waiting out
   * SCRAPE_STALE_DAYS of absence from the search results.
   *
   * 403 deliberately does NOT count. That is a bot wall, and treating it as
   * "gone" would empty the whole catalogue the first time an IP got blocked.
   */
  if (status === 404 || status === 410) {
    log.debug(`${candidate.sourceUrl} is gone (${status})`);
    return { kind: 'gone', status };
  }

  if (status === 0 || status >= 400) {
    log.debug(`${candidate.sourceUrl} returned ${status || 'no response'}`);
    return { kind: 'unreachable', status };
  }

  await coaxLazyImages(page);
  // Give whatever the scroll triggered a moment to land. `networkidle` alone is
  // unreliable on pages with polling analytics, hence the plain wait as a floor.
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);
  await sleep(SETTLE_MS);

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
  }

  return { kind: 'ok', images: found };
}

/**
 * Fills in galleries for listings whose search response only carried part of the
 * album.
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
    source: { notIn: NO_LISTING_PAGE },
    // MIN_IMAGES defaults to 0, i.e. no gate — see the constant.
    ...(MIN_IMAGES > 0 ? { photoCount: { lt: MIN_IMAGES } } : {}),
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
  log.info(`fetching galleries for ${pending.length} of ${remaining} listing(s)`);

  const page = await browsers.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  /**
   * Page routes take precedence over the context route that `BrowserPool`
   * installs, so this is where images stop being aborted and start being stubbed.
   * `fallback()` hands everything else back to the context handler, which still
   * blocks fonts and media.
   */
  await page.route('**/*', (route: Route) => {
    if (route.request().resourceType() === 'image') {
      return route.fulfill({ status: 200, contentType: 'image/gif', body: STUB_GIF }).catch(() => undefined);
    }
    return route.fallback();
  });

  let improved = 0;
  let added = 0;
  let empty = 0;
  let unreachable = 0;
  let gone = 0;
  const bySource = new Map<string, { listings: number; photos: number }>();

  try {
    for (const candidate of pending) {
      const outcome = await fetchGallery(page, candidate);

      if (outcome.kind !== 'ok') {
        // Stamped either way — see the note in fetchGallery. The stored photos
        // are untouched, so the cover photo is not lost.
        await prisma.property.update({
          where: { id: candidate.id },
          data: { photosFetchedAt: new Date() },
        });

        if (outcome.kind === 'gone') {
          // The ad is down. Recording it here is the whole reason the cleanup
          // pass can act on real evidence instead of waiting out the staleness
          // window — and the app can tell "no longer listed" from "dropped out
          // of the search results".
          await markGone(candidate.id);
          gone += 1;
        } else {
          unreachable += 1;
        }

        await sleep(DELAY_MS);
        continue;
      }

      const images = merge(candidate.images, outcome.images);
      const gained = images.length - candidate.images.length;

      await prisma.property.update({
        where: { id: candidate.id },
        data: { images, photoCount: images.length, photosFetchedAt: new Date() },
      });
      // The gallery changed, so the mirror index has to follow it.
      await syncPhotoRows(candidate.id, images).catch(() => undefined);

      const tally = bySource.get(candidate.source) ?? { listings: 0, photos: 0 };
      tally.listings += 1;
      tally.photos += images.length;
      bySource.set(candidate.source, tally);

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
      `${empty} had nothing more to give, ${gone} ad(s) are down, ` +
      `${unreachable} page(s) could not be read`,
  );

  // Per-source averages, because "photos are still missing" is almost always one
  // portal rather than all of them, and this is the line that says which.
  for (const [source, tally] of [...bySource.entries()].sort()) {
    log.info(`  ${source}: ${(tally.photos / tally.listings).toFixed(1)} photo(s) per listing`);
  }

  if (remaining > pending.length) {
    const runsLeft = Math.ceil((remaining - pending.length) / MAX_PER_RUN);
    log.info(`${remaining - pending.length} still pending — about ${runsLeft} more run(s) at this rate`);
  }

  // A pass that improves nothing at all is worth saying out loud: it means every
  // strategy missed, which is a markup change rather than a quiet week.
  if (improved === 0 && unreachable < pending.length) {
    log.warn(
      'no listing gained a photo. Either these really do have one photo each, or the gallery moved — ' +
        'open one of the sourceUrls in a browser and check. PHOTOS_ENABLED=false turns this pass off.',
    );
  }
}

/**
 * Re-queues listings for the backfill, so a config change or a parser fix can be
 * applied to rows that were already stamped. Returns how many were queued.
 */
export async function resetPhotoStamps(options: { below?: number } = {}): Promise<number> {
  const { count } = await prisma.property.updateMany({
    where: {
      active: true,
      photosFetchedAt: { not: null },
      source: { notIn: NO_LISTING_PAGE },
      ...(options.below !== undefined ? { photoCount: { lt: options.below } } : {}),
    },
    data: { photosFetchedAt: null },
  });
  return count;
}

/** Exposed so the doctor can report why carousels might be short. */
export const PHOTOS_STATUS = {
  enabled: ENABLED,
  maxPerRun: MAX_PER_RUN,
  minImages: MIN_IMAGES,
  maxPerListing: MAX_PHOTOS,
  delayMs: DELAY_MS,
  skipsSources: NO_LISTING_PAGE,
  timezone: config.timezone,
};
