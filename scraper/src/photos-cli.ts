import { BrowserPool } from './browser.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { backfillPhotos, resetPhotoStamps } from './photos.js';

/**
 * Runs the gallery backfill on its own, without a full scrape:
 *
 *   docker compose exec scraper node dist/photos-cli.js
 *   docker compose exec scraper node dist/photos-cli.js --reset
 *   docker compose exec scraper node dist/photos-cli.js --reset=5
 *   make photos [N=400] [RESET=1]
 *
 * Useful in three situations. Right after upgrading, when the catalogue is full
 * of listings stored with only their cover photo and waiting for cron to work
 * through them is slow. When a carousel is short and you want to see exactly what
 * the pass found. And after a change to the pass itself.
 *
 * ## --reset
 *
 * A listing is visited once: `photos_fetched_at` is stamped whether or not
 * anything was found, which is what stops the pass re-opening the same pages
 * every run. That also means an *improvement* to the pass does not reach the rows
 * it already gave up on. `--reset` clears the stamp so they are queued again;
 * `--reset=N` only clears it for listings with fewer than N photos, which is the
 * one you usually want.
 *
 * Raise the budget for a big catch-up:
 *   docker compose exec -e PHOTOS_MAX_PER_RUN=2000 scraper node dist/photos-cli.js --reset=5
 */
const log = logger('photos-cli');

const resetArg = process.argv.slice(2).find((arg) => arg === '--reset' || arg.startsWith('--reset='));

async function main() {
  if (resetArg) {
    const raw = resetArg.includes('=') ? Number(resetArg.split('=')[1]) : Number.NaN;
    const below = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : undefined;
    const queued = await resetPhotoStamps({ below });
    log.info(
      below === undefined
        ? `re-queued ${queued} listing(s) for the gallery pass`
        : `re-queued ${queued} listing(s) with fewer than ${below} photo(s)`,
    );
    if (queued === 0) return;
  }

  const browsers = new BrowserPool();
  try {
    await backfillPhotos(browsers);
  } finally {
    await browsers.close();
  }
}

main()
  .catch((err) => {
    log.error('photo backfill failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
