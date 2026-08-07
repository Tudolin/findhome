import { prisma } from './db.js';
import { logger } from './logger.js';
import { runCleanup } from './cleanup.js';
import { MEDIA_STATUS, mirrorPending, mirroredBytes } from './media.js';

/**
 * The photo mirror and the housekeeping pass, on demand:
 *
 *   docker compose exec scraper node dist/media-cli.js          mirror + cleanup
 *   docker compose exec scraper node dist/media-cli.js mirror   download only
 *   docker compose exec scraper node dist/media-cli.js clean    housekeeping only
 *   docker compose exec scraper node dist/media-cli.js status   what is stored
 *
 *   make mirror [N=4000]
 *   make media-clean
 *   make media-status
 *
 * Both run automatically at the end of every scrape. This is for working through
 * a backlog after enabling the mirror, and for reclaiming disk without waiting
 * for the next cron tick.
 */
const log = logger('media-cli');

const command = process.argv[2] ?? 'all';

async function status() {
  const [photos, mirrored, failed, bytes, listings, gone, purgeable] = await Promise.all([
    prisma.propertyPhoto.count(),
    prisma.propertyPhoto.count({ where: { path: { not: null } } }),
    prisma.propertyPhoto.count({ where: { path: null, failCount: { gte: MEDIA_STATUS.maxFailures } } }),
    mirroredBytes(),
    prisma.property.count({ where: { active: true } }),
    prisma.property.count({ where: { active: false } }),
    prisma.property.count({
      where: {
        active: false,
        interactions: { none: {} },
        comments: { none: {} },
        visits: { none: {} },
      },
    }),
  ]);

  const line = '-'.repeat(64);
  console.log(line);
  console.log('FindHome photo mirror');
  console.log(line);
  console.log(`root:      ${MEDIA_STATUS.root}`);
  console.log(`enabled:   ${MEDIA_STATUS.enabled ? 'yes' : 'no'}`);
  console.log(`budget:    ${Math.round(bytes / 1048576)} / ${MEDIA_STATUS.maxMb} MB`);
  console.log(`photos:    ${mirrored} of ${photos} indexed have a local copy`);
  console.log(`given up:  ${failed} (failed ${MEDIA_STATUS.maxFailures}× — see property_photos.last_error)`);
  console.log(`pending:   ${photos - mirrored - failed}`);
  console.log('');
  console.log(`listings:  ${listings} live · ${gone} no longer listed`);
  console.log(`purgeable: ${purgeable} of those ${gone} have no ratings, notes or visits attached`);
  console.log(`           the other ${gone - purgeable} are kept regardless of age`);
  console.log(line);
}

async function main() {
  if (command === 'status') return status();

  if (command === 'mirror' || command === 'all') {
    if (!MEDIA_STATUS.enabled) {
      log.warn('PHOTOS_MIRROR=false — nothing to do. Set it to true to store photo files locally.');
    } else {
      await mirrorPending();
    }
  }

  if (command === 'clean' || command === 'all') {
    await runCleanup();
  }

  if (!['mirror', 'clean', 'all', 'status'].includes(command)) {
    log.error(`unknown command "${command}". Use: mirror | clean | status | all`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    log.error('failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
