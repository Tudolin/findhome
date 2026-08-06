import { BrowserPool } from './browser.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { backfillPhotos } from './photos.js';

/**
 * Runs the gallery backfill on its own, without a full scrape:
 *
 *   docker compose exec scraper node dist/photos-cli.js
 *   make photos
 *
 * Useful in two situations. First, right after upgrading: the catalogue is full
 * of listings that were stored with only their cover photo, and waiting for cron
 * to work through them 60 at a time is slow. Second, when a carousel is one photo
 * long and you want to know why — this prints exactly what the pass found.
 *
 * Raise the budget for a catch-up pass:
 *   docker compose exec -e PHOTOS_MAX_PER_RUN=400 scraper node dist/photos-cli.js
 */
const log = logger('photos-cli');

const browsers = new BrowserPool();

backfillPhotos(browsers)
  .catch((err) => {
    log.error('photo backfill failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browsers.close();
    await prisma.$disconnect().catch(() => undefined);
  });
