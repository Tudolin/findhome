import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Prisma } from '@prisma/client';
import { env } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';

const log = logger('media');

/**
 * Local mirror of listing photos.
 *
 * ## Why files, not just URLs
 *
 * Two failures that both look like "the photos broke":
 *
 *  1. **Portals expire their photo URLs.** A flat shortlisted in March comes back
 *     in May as a wall of grey placeholders — exactly when you are comparing the
 *     three you visited and need to remember which had the good kitchen.
 *  2. **OLX's CDN refuses any Referer that is not olx.com.br.** The browser
 *     cannot send one (see ListingImage.tsx, which works around it by sending
 *     *none*). The scraper can, because it fetches server-side. So mirroring is
 *     the permanent fix for those 403s rather than a workaround.
 *
 * ## Layout
 *
 * Content-addressed by a hash of the normalised URL:
 *
 *   /media/a3/a3f19c…c4.webp
 *
 * Two listings advertising the same flat therefore share one file. The two-level
 * fan-out keeps any single directory to a few thousand entries, which matters on
 * the filesystems a home server is likely to be using.
 *
 * ## Budget
 *
 * Disk is the constraint, not bandwidth: 10.000 listings × 20 photos × 120 kB is
 * 24 GB, which is not something to help yourself to on someone's laptop. So there
 * is a hard ceiling (PHOTOS_MIRROR_MAX_MB) and a priority order — photos of
 * listings this household has actually reacted to are mirrored first and evicted
 * last, because those are the ones whose disappearance costs real work.
 */

const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined || value.trim() === '' ? fallback : value.toLowerCase() === 'true';

const int = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const MEDIA_ROOT = resolve(env('MEDIA_ROOT', '/media'));

export const MIRROR = {
  enabled: bool(process.env.PHOTOS_MIRROR, true),
  /** Downloads per run. Each is one HTTP request for ~100 kB. */
  maxPerRun: Math.max(0, int(process.env.PHOTOS_MIRROR_MAX_PER_RUN, 400)),
  /** Hard disk ceiling for the whole mirror. */
  maxMb: Math.max(0, int(process.env.PHOTOS_MIRROR_MAX_MB, 2048)),
  /** Politeness delay between downloads. */
  delayMs: Math.max(0, int(process.env.PHOTOS_MIRROR_DELAY_MS, 120)),
  /** Anything bigger than this is not a listing photo. */
  maxFileKb: Math.max(64, int(process.env.PHOTOS_MIRROR_MAX_FILE_KB, 4096)),
  /** Give up on a URL after this many failures. */
  maxFailures: Math.max(1, int(process.env.PHOTOS_MIRROR_MAX_FAILURES, 3)),
  timeoutMs: Math.max(3000, int(process.env.PHOTOS_MIRROR_TIMEOUT_MS, 20_000)),
};

/** Only these become files. Anything else is a redirect to an error page. */
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

/**
 * Identity of a photo, ignoring the query string. Must stay in step with
 * `photoKey` in persist.ts and photos.ts — the three of them are the same rule,
 * and a mirror keyed differently from the index would never find its own files.
 */
export const photoKey = (url: string) => url.split('?')[0].split('#')[0];

/** Relative storage path for a URL: "a3/a3f19c…c4.webp". */
export function mediaPath(remoteUrl: string, extension: string): string {
  const digest = createHash('sha256').update(photoKey(remoteUrl)).digest('hex');
  return `${digest.slice(0, 2)}/${digest}.${extension}`;
}

/**
 * Resolves a stored path to an absolute one, refusing anything that escapes the
 * root. Belt and braces: these paths are generated from a hex digest and can
 * never contain `..`, but this function is also what the web app's media route
 * relies on, and a traversal there would serve arbitrary files off the server.
 */
export function resolveMedia(relative: string): string | null {
  const absolute = resolve(MEDIA_ROOT, relative);
  if (absolute !== MEDIA_ROOT && !absolute.startsWith(MEDIA_ROOT + sep)) return null;
  return absolute;
}

/**
 * A Referer the CDN will accept.
 *
 * This is the whole reason mirroring fixes OLX rather than merely caching it:
 * measured against img.olx.com.br with the same URL, `Referer: <this app>` is
 * 403 and `Referer: https://www.olx.com.br/` is 200. Server-side we can send the
 * portal's own, which a browser is not allowed to fake.
 */
function refererFor(url: string): string {
  try {
    const { hostname } = new URL(url);
    // img.olx.com.br -> https://www.olx.com.br/ , imgbr.imovelwebcdn.com ->
    // https://www.imovelweb.com.br/ , and so on: the site, not the CDN.
    const site = [
      ['olx', 'https://www.olx.com.br/'],
      ['imovelweb', 'https://www.imovelweb.com.br/'],
      ['chavesnamao', 'https://www.chavesnamao.com.br/'],
      ['quintoandar', 'https://www.quintoandar.com.br/'],
      ['zapimoveis', 'https://www.zapimoveis.com.br/'],
      ['vivareal', 'https://www.vivareal.com.br/'],
    ].find(([needle]) => hostname.includes(needle));
    return site ? site[1] : `https://${hostname}/`;
  } catch {
    return '';
  }
}

type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
};

const httpFetch = (
  globalThis as unknown as {
    fetch: (url: string, init?: { headers?: Record<string, string>; signal?: unknown; redirect?: string }) => Promise<FetchResponse>;
  }
).fetch;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type DownloadResult =
  | { kind: 'stored'; path: string; bytes: number; contentType: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string };

/**
 * Downloads one photo and writes it under MEDIA_ROOT.
 *
 * Written to a temporary name and renamed into place, so a crash mid-download
 * cannot leave a half-file that the web app then serves as a broken image.
 * `rename` within one filesystem is atomic.
 */
async function download(remoteUrl: string): Promise<DownloadResult> {
  let response: FetchResponse;
  try {
    response = await httpFetch(remoteUrl, {
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
        'accept-language': 'pt-BR,pt;q=0.9',
        referer: refererFor(remoteUrl),
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(MIRROR.timeoutMs),
    });
  } catch (err) {
    return { kind: 'failed', reason: (err as Error).message.slice(0, 180) };
  }

  if (!response.ok) return { kind: 'failed', reason: `HTTP ${response.status}` };

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const extension = EXTENSION[contentType];
  // Not an image: the CDN answered with an HTML error page or a redirect target.
  // A permanent condition, so it counts as a failure rather than a retry.
  if (!extension) return { kind: 'failed', reason: `not an image (${contentType || 'no content-type'})` };

  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MIRROR.maxFileKb * 1024) {
    return { kind: 'skipped', reason: `${Math.round(declared / 1024)} kB exceeds the per-file cap` };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) return { kind: 'failed', reason: 'empty body' };
  if (buffer.byteLength > MIRROR.maxFileKb * 1024) {
    return { kind: 'skipped', reason: `${Math.round(buffer.byteLength / 1024)} kB exceeds the per-file cap` };
  }

  const relative = mediaPath(remoteUrl, extension);
  const absolute = resolveMedia(relative);
  if (!absolute) return { kind: 'failed', reason: 'path escaped the media root' };

  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.part`;
  await writeFile(temporary, buffer);
  await rename(temporary, absolute);

  return { kind: 'stored', path: relative, bytes: buffer.byteLength, contentType };
}

/**
 * Brings `property_photos` in step with `Property.images`.
 *
 * Called wherever the image list is written, so the mirror index never drifts
 * from the gallery. Rows for URLs that are no longer in the list are deleted;
 * their *files* are not touched here, because another listing may share them —
 * `pruneOrphanFiles` in cleanup.ts is what reclaims those, once nothing points at
 * them any more.
 */
export async function syncPhotoRows(propertyId: string, images: string[]): Promise<void> {
  if (!MIRROR.enabled) return;

  const wanted = new Map<string, number>();
  images.forEach((url, index) => {
    if (!/^https?:\/\//i.test(url)) return;
    const key = photoKey(url).slice(0, 700);
    if (!wanted.has(key)) wanted.set(key, index);
  });

  const existing = await prisma.propertyPhoto.findMany({
    where: { propertyId },
    select: { id: true, remoteUrl: true, position: true },
  });
  const known = new Map(existing.map((row) => [row.remoteUrl, row]));

  const stale = existing.filter((row) => !wanted.has(row.remoteUrl)).map((row) => row.id);
  if (stale.length) await prisma.propertyPhoto.deleteMany({ where: { id: { in: stale } } });

  for (const [remoteUrl, position] of wanted) {
    const row = known.get(remoteUrl);
    if (!row) {
      await prisma.propertyPhoto
        .create({ data: { propertyId, remoteUrl, position } })
        // Two concurrent writers for the same listing is not a scenario this
        // runs in, but a unique-violation here must never abort a scrape.
        .catch(() => undefined);
    } else if (row.position !== position) {
      // The portal reordered its carousel. Keep the file, fix the order.
      await prisma.propertyPhoto.update({ where: { id: row.id }, data: { position } }).catch(() => undefined);
    }
  }
}

/** Bytes currently held by the mirror, from the index rather than the disk. */
export async function mirroredBytes(): Promise<number> {
  const { _sum } = await prisma.propertyPhoto.aggregate({
    where: { path: { not: null } },
    _sum: { bytes: true },
  });
  return _sum.bytes ?? 0;
}

/**
 * Downloads the photos that have no local copy yet.
 *
 * Priority is the interesting part. Photos are mirrored in this order:
 *
 *   1. listings somebody in this household has reacted to — rated, shortlisted,
 *      pinned, booked a visit for. These are the ones whose photos disappearing
 *      actually costs something.
 *   2. everything else, newest first.
 *
 * The same order runs backwards for eviction when the disk budget is hit, so the
 * mirror degrades by dropping the listings nobody cared about.
 */
export async function mirrorPending(): Promise<void> {
  if (!MIRROR.enabled || MIRROR.maxPerRun === 0) return;

  await mkdir(MEDIA_ROOT, { recursive: true }).catch(() => undefined);

  const budgetBytes = MIRROR.maxMb * 1024 * 1024;
  let used = await mirroredBytes();
  if (budgetBytes > 0 && used >= budgetBytes) {
    log.warn(
      `mirror is at its ${MIRROR.maxMb} MB budget — nothing new will be stored. ` +
        'Raise PHOTOS_MIRROR_MAX_MB, or let `make media-clean` evict what is no longer needed.',
    );
    return;
  }

  const queue: PhotoRow[] = [];

  // Pass 1: photos of listings this household has acted on.
  queue.push(
    ...(await pendingPhotos(MIRROR.maxPerRun, {
      property: { interactions: { some: { status: { not: 'DISCOVERED' } } } },
    })),
  );

  // Pass 2: fill the remaining budget with the newest active listings.
  if (queue.length < MIRROR.maxPerRun) {
    const seen = new Set(queue.map((row) => row.id));
    const rest = await pendingPhotos(MIRROR.maxPerRun - queue.length, { property: { active: true } });
    queue.push(...rest.filter((row) => !seen.has(row.id)));
  }

  if (queue.length === 0) return;

  const pending = await prisma.propertyPhoto.count({
    where: { path: null, failCount: { lt: MIRROR.maxFailures } },
  });
  log.info(`mirroring ${queue.length} of ${pending} photo(s) · ${Math.round(used / 1048576)}/${MIRROR.maxMb} MB used`);

  let stored = 0;
  let failed = 0;
  let skipped = 0;

  for (const photo of queue) {
    if (budgetBytes > 0 && used >= budgetBytes) {
      log.info(`stopped at the ${MIRROR.maxMb} MB budget with ${queue.length - stored - failed - skipped} left`);
      break;
    }

    const result = await download(photo.remoteUrl);

    if (result.kind === 'stored') {
      await prisma.propertyPhoto.update({
        where: { id: photo.id },
        data: {
          path: result.path,
          bytes: result.bytes,
          contentType: result.contentType,
          fetchedAt: new Date(),
          failCount: 0,
          lastError: null,
        },
      });
      used += result.bytes;
      stored += 1;
    } else {
      // A skip is permanent (the file is simply too big), so it is stamped with
      // the failure ceiling rather than left to be retried forever.
      const permanent = result.kind === 'skipped';
      await prisma.propertyPhoto.update({
        where: { id: photo.id },
        data: {
          fetchedAt: new Date(),
          failCount: permanent ? MIRROR.maxFailures : photo.failCount + 1,
          lastError: result.reason.slice(0, 200),
        },
      });
      if (permanent) skipped += 1;
      else failed += 1;
    }

    if (MIRROR.delayMs) await sleep(MIRROR.delayMs);
  }

  log.info(
    `mirror: stored ${stored}, failed ${failed}, skipped ${skipped} · ` +
      `${Math.round(used / 1048576)}/${MIRROR.maxMb} MB used`,
  );

  if (stored === 0 && failed > 0) {
    log.warn(
      'every download failed. The usual causes are no outbound network from the container, ' +
        'or a CDN that has started refusing us — the lastError column on property_photos says which.',
    );
  }
}

type PhotoRow = { id: string; remoteUrl: string; failCount: number };

/**
 * Photos with no local copy that have not been given up on, newest listing first.
 *
 * `extra` is typed as a Prisma where rather than `Record<string, unknown>`: a
 * record spread into a where clause produces an index signature of `unknown`,
 * which is not assignable to the specific filter types and fails to compile.
 */
async function pendingPhotos(take: number, extra: Prisma.PropertyPhotoWhereInput): Promise<PhotoRow[]> {
  if (take <= 0) return [];
  return prisma.propertyPhoto.findMany({
    where: { path: null, failCount: { lt: MIRROR.maxFailures }, ...extra },
    orderBy: [{ property: { createdAt: 'desc' } }, { position: 'asc' }],
    take,
    select: { id: true, remoteUrl: true, failCount: true },
  });
}

/** Deletes one mirrored file, tolerating it already being gone. */
export async function removeMediaFile(relative: string): Promise<number> {
  const absolute = resolveMedia(relative);
  if (!absolute) return 0;
  try {
    const info = await stat(absolute);
    await rm(absolute, { force: true });
    return info.size;
  } catch {
    return 0;
  }
}

/** Every file under MEDIA_ROOT, as paths relative to it. */
export async function listMediaFiles(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (directory: string, prefix: string) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), relative);
      // `.part` files are interrupted downloads; cleanup.ts sweeps them.
      else out.push(relative);
    }
  };
  await walk(MEDIA_ROOT, '');
  return out;
}

/** Exposed so the doctor can report where the mirror stands. */
export const MEDIA_STATUS = { root: MEDIA_ROOT, ...MIRROR };
