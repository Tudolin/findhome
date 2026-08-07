import { rm } from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { logger } from './logger.js';
import {
  listMediaFiles,
  MEDIA_ROOT,
  MIRROR,
  mirroredBytes,
  removeMediaFile,
  resolveMedia,
} from './media.js';

const log = logger('cleanup');

/**
 * Housekeeping for listings that have gone away, and for the disk they left
 * behind.
 *
 * Three distinct things happen when an ad comes down, and before this they were
 * all silently absent:
 *
 *  1. **The row goes inactive.** `deactivateStale` in persist.ts already did this
 *     after SCRAPE_STALE_DAYS of not appearing in search results — but that is a
 *     guess. The gallery pass opens listing pages anyway, so a 404/410 there is
 *     direct evidence, and `gone_at` records it the day it happens instead of
 *     three weeks later.
 *  2. **The row is eventually deleted.** Nothing ever removed them, so the
 *     catalogue only grew. This purges them — with one hard rule below.
 *  3. **Its photos are reclaimed.** Mirrored files are content-addressed and
 *     shared between listings, so a file can only go once *nothing* references it.
 *
 * ## The hard rule
 *
 * **A listing anyone has touched is never deleted.** A rating, a status, a pin, a
 * comment, a booked visit — any of those means somebody did work on that flat, and
 * "the ad expired" is not a reason to throw their notes away. Those rows stay
 * forever, marked inactive, and the app shows them with a "no longer listed"
 * badge. Their photos are also the *last* thing evicted under disk pressure,
 * because they are the ones you can no longer go and look at on the portal.
 */

const int = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const CLEANUP = {
  /**
   * Delete untouched inactive listings after this many days. 0 disables deletion
   * entirely, which keeps the old behaviour of growing forever.
   */
  purgeAfterDays: Math.max(0, int(process.env.CLEANUP_PURGE_DAYS, 60)),
  /** Listings deleted per run, so one pass cannot lock the table for minutes. */
  maxPurgePerRun: Math.max(0, int(process.env.CLEANUP_MAX_PER_RUN, 2000)),
  /**
   * Days to wait before collapsing a closed ad's gallery down to `archiveKeep`
   * photos.
   *
   * Not immediate, on purpose: portals re-post listings, and an ad that comes back
   * within the week should find its gallery intact rather than have to re-download
   * twenty files.
   */
  archiveAfterDays: Math.max(0, int(process.env.CLEANUP_ARCHIVE_DAYS, 7)),
  /**
   * Photos kept per archived listing. One cover is enough to recognise the flat
   * on a card and in the shortlist, which is all an archive is for; keeping twenty
   * of a place nobody can rent is what fills the disk budget with history.
   *
   * 0 keeps every photo — pick that if disk is not a concern and you want the full
   * record.
   */
  archiveKeep: Math.max(0, int(process.env.CLEANUP_ARCHIVE_KEEP, 1)),
};

export type CleanupReport = {
  markedGone: number;
  purged: number;
  protected: number;
  /** Closed ads whose gallery was collapsed to its cover photo. */
  archived: number;
  archivedPhotos: number;
  filesRemoved: number;
  bytesReclaimed: number;
  partialsRemoved: number;
};

/**
 * Records that a listing's own page no longer exists.
 *
 * Called from the gallery pass, which is already loading that page — a 404 or 410
 * there is the portal telling us the ad is down, which is worth acting on
 * immediately rather than waiting for SCRAPE_STALE_DAYS of absence.
 *
 * 403 is deliberately NOT treated as gone: that is a bot wall, and marking every
 * listing dead because an IP got blocked would empty the catalogue.
 */
export async function markGone(propertyId: string): Promise<void> {
  /**
   * `updateMany` with `goneAt: null` in the filter, so the stamp is written once
   * and keeps meaning "when we FIRST saw this go". A plain `update` would move it
   * forward on every re-check, and "gone since yesterday" for an ad that came down
   * in March is worse than no date at all.
   *
   * `active` is set here too and unconditionally — a listing that came back and
   * then went again should end up inactive whatever its old stamp says. Hence two
   * statements rather than one.
   */
  await prisma.property
    .updateMany({ where: { id: propertyId, goneAt: null }, data: { goneAt: new Date() } })
    .catch(() => undefined);
  await prisma.property
    .update({ where: { id: propertyId }, data: { active: false } })
    .catch(() => undefined);
}

/**
 * True when a listing has any human work attached to it. The guard that stops the
 * purge from deleting somebody's shortlist.
 */
const UNTOUCHED = {
  interactions: { none: {} },
  comments: { none: {} },
  visits: { none: {} },
} as const;

/**
 * Deletes inactive listings nobody ever touched.
 *
 * Photos cascade with the row (`onDelete: Cascade` on property_photos), which is
 * what then makes their files orphans for `pruneOrphanFiles` to collect. Deleting
 * the files here instead would be wrong: content-addressed files are shared, and
 * another live listing may point at the same photo.
 */
export async function purgeDeadListings(): Promise<{ purged: number; protected: number }> {
  if (CLEANUP.purgeAfterDays === 0 || CLEANUP.maxPurgePerRun === 0) return { purged: 0, protected: 0 };

  const cutoff = new Date(Date.now() - CLEANUP.purgeAfterDays * 86_400_000);
  const where = { active: false, lastSeenAt: { lt: cutoff } };

  const doomed = await prisma.property.findMany({
    where: { ...where, ...UNTOUCHED },
    select: { id: true },
    take: CLEANUP.maxPurgePerRun,
  });

  // Counted separately and reported, not silently skipped: "1.400 listings are
  // being kept because you reviewed them" is useful information, and its absence
  // is what makes a cleanup pass feel like it is not working.
  const kept = await prisma.property.count({ where: { ...where, NOT: UNTOUCHED } });

  if (doomed.length === 0) return { purged: 0, protected: kept };

  const { count } = await prisma.property.deleteMany({ where: { id: { in: doomed.map((p) => p.id) } } });
  return { purged: count, protected: kept };
}

/**
 * Removes mirrored files nothing points at any more.
 *
 * Runs after the purge, in one pass over the directory. The index is loaded into
 * a Set first: at mirror scale (tens of thousands of short strings) that is a few
 * MB of memory and turns the whole job into one query plus one directory walk,
 * instead of a query per file.
 */
export async function pruneOrphanFiles(): Promise<{ files: number; bytes: number; partials: number }> {
  const files = await listMediaFiles();
  if (files.length === 0) return { files: 0, bytes: 0, partials: 0 };

  const referenced = new Set(
    (
      await prisma.propertyPhoto.findMany({
        where: { path: { not: null } },
        select: { path: true },
      })
    ).map((row) => row.path as string),
  );

  let removed = 0;
  let bytes = 0;
  let partials = 0;

  for (const relative of files) {
    // An interrupted download. `download()` writes to `<name>.part` and renames,
    // so one of these means the process died mid-write; it is never valid.
    if (relative.endsWith('.part')) {
      const absolute = resolveMedia(relative);
      if (absolute) await rm(absolute, { force: true }).catch(() => undefined);
      partials += 1;
      continue;
    }

    if (referenced.has(relative)) continue;
    bytes += await removeMediaFile(relative);
    removed += 1;
  }

  return { files: removed, bytes, partials };
}

/**
 * Collapses a closed ad's mirrored gallery down to its cover photo.
 *
 * ## Why keep one rather than none or all
 *
 * An archived listing is a *record*: what you need from it is to recognise the
 * flat in your shortlist and remember what you thought of it. One photo does that.
 * Twenty do not do it twenty times better, and at 120 kB each they are what
 * quietly fills a 2 GB budget with places nobody can rent — crowding out the
 * mirrors of listings that are still live.
 *
 * Keeping *none* would be worse than keeping all: a shortlist of grey boxes is
 * unusable, and the cover is the cheapest thing that makes it readable.
 *
 * ## Why only the `path` is cleared
 *
 * Files are content-addressed and shared — a live listing may point at the same
 * photo. So nothing is deleted here; the rows keep their URLs (the history is
 * intact) and `pruneOrphanFiles` reclaims a file once *nothing* references it.
 *
 * The web app already knows what to do with the result: `galleryFor()` renders
 * only the mirrored copies of a closed ad and reports the rest as `missing`, so
 * the UI says "12 photos are no longer available" instead of showing twelve dead
 * URLs.
 */
export async function collapseArchivedGalleries(): Promise<{ listings: number; photos: number }> {
  if (!MIRROR.enabled || CLEANUP.archiveKeep === 0) return { listings: 0, photos: 0 };

  const cutoff = new Date(Date.now() - CLEANUP.archiveAfterDays * 86_400_000);

  // Closed long enough ago, and still holding more copies than an archive needs.
  const candidates = await prisma.property.findMany({
    where: {
      active: false,
      lastSeenAt: { lt: cutoff },
      photos: { some: { path: { not: null } } },
    },
    select: {
      id: true,
      photos: {
        where: { path: { not: null } },
        orderBy: { position: 'asc' },
        select: { id: true },
      },
    },
    take: 500,
  });

  let listings = 0;
  let photos = 0;

  for (const property of candidates) {
    const surplus = property.photos.slice(CLEANUP.archiveKeep);
    if (surplus.length === 0) continue;

    await prisma.propertyPhoto.updateMany({
      where: { id: { in: surplus.map((p) => p.id) } },
      // `fetchedAt` and `failCount` are left alone: this is not a failure, and
      // the row stays eligible to be re-mirrored if the ad ever comes back.
      data: { path: null, bytes: 0, contentType: null },
    });

    listings += 1;
    photos += surplus.length;
  }

  return { listings, photos };
}

/**
 * Brings the mirror back under its disk budget.
 *
 * Eviction order is the reverse of the mirror's priority order: untouched
 * listings go first, then inactive ones, and photos of listings somebody reacted
 * to go last — those are precisely the ones that can no longer be fetched from
 * the portal, so they are the copies worth keeping.
 *
 * Only the `path` is cleared, not the row: the URL stays, so a photo evicted
 * today still renders from the portal and can be re-mirrored if the budget frees
 * up. `failCount` is left alone so this is not mistaken for a download failure.
 */
export async function enforceMediaBudget(): Promise<{ files: number; bytes: number }> {
  const budget = MIRROR.maxMb * 1024 * 1024;
  if (budget <= 0) return { files: 0, bytes: 0 };

  let used = await mirroredBytes();
  if (used <= budget) return { files: 0, bytes: 0 };

  log.warn(`mirror is ${Math.round(used / 1048576)} MB, over the ${MIRROR.maxMb} MB budget — evicting`);

  let files = 0;
  let bytes = 0;

  // Least valuable first. Each tier is drained before the next is touched.
  // Typed as a Prisma where, not Record<string, unknown>: a record spread into a
  // where clause yields an index signature of `unknown`, which does not compile.
  const tiers: Array<{ label: string; where: Prisma.PropertyPhotoWhereInput }> = [
    { label: 'untouched, no longer listed', where: { property: { active: false, ...UNTOUCHED } } },
    { label: 'untouched', where: { property: UNTOUCHED } },
    { label: 'no longer listed', where: { property: { active: false } } },
    { label: 'anything', where: {} },
  ];

  for (const tier of tiers) {
    while (used > budget) {
      const batch = await prisma.propertyPhoto.findMany({
        where: { path: { not: null }, ...tier.where },
        // Oldest first within a tier: a photo mirrored long ago has had its use.
        orderBy: { fetchedAt: 'asc' },
        take: 200,
        select: { id: true, path: true, bytes: true },
      });
      if (batch.length === 0) break;

      for (const photo of batch) {
        if (used <= budget) break;
        const freed = await removeMediaFile(photo.path as string);
        await prisma.propertyPhoto.update({
          where: { id: photo.id },
          data: { path: null, bytes: 0, contentType: null },
        });
        used -= photo.bytes || freed;
        bytes += freed;
        files += 1;
      }
    }
    if (used <= budget) {
      if (files > 0) log.info(`evicted ${files} file(s) from the "${tier.label}" tier`);
      break;
    }
  }

  return { files, bytes };
}

/**
 * One full housekeeping pass. Never throws — called at the end of a scrape, and
 * a failure to tidy up is not a failed scrape.
 */
export async function runCleanup(): Promise<CleanupReport> {
  const report: CleanupReport = {
    markedGone: 0,
    purged: 0,
    protected: 0,
    archived: 0,
    archivedPhotos: 0,
    filesRemoved: 0,
    bytesReclaimed: 0,
    partialsRemoved: 0,
  };

  const purge = await purgeDeadListings();
  report.purged = purge.purged;
  report.protected = purge.protected;

  if (MIRROR.enabled) {
    // Order matters. Collapse first, so the photos it releases are already
    // unreferenced when the orphan sweep runs — otherwise their disk is only
    // reclaimed a whole run later. The budget check comes after, since collapsing
    // may already have brought the mirror back under it.
    const collapsed = await collapseArchivedGalleries();
    report.archived = collapsed.listings;
    report.archivedPhotos = collapsed.photos;

    const budget = await enforceMediaBudget();
    const orphans = await pruneOrphanFiles();
    report.filesRemoved = budget.files + orphans.files;
    report.bytesReclaimed = budget.bytes + orphans.bytes;
    report.partialsRemoved = orphans.partials;
  }

  const bits: string[] = [];
  if (report.purged) bits.push(`deleted ${report.purged} listing(s) nobody had touched`);
  if (report.protected) bits.push(`kept ${report.protected} reviewed one(s)`);
  if (report.archived) {
    bits.push(
      `archived ${report.archived} closed ad(s) down to ${CLEANUP.archiveKeep} photo(s), ` +
        `releasing ${report.archivedPhotos}`,
    );
  }
  if (report.filesRemoved) {
    bits.push(`reclaimed ${Math.round(report.bytesReclaimed / 1048576)} MB from ${report.filesRemoved} file(s)`);
  }
  if (report.partialsRemoved) bits.push(`swept ${report.partialsRemoved} interrupted download(s)`);

  if (bits.length) log.info(`cleanup: ${bits.join(' · ')}`);
  else log.debug('cleanup: nothing to do');

  return report;
}

/** Exposed so the doctor can report the policy in force. */
export const CLEANUP_STATUS = { ...CLEANUP, mediaRoot: MEDIA_ROOT };
