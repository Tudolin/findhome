import { config, parseSources } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { runScrape } from './runner.js';

/**
 * One-shot run, for testing a parser without waiting for cron:
 *
 *   docker compose exec scraper node dist/cli.js
 *   docker compose exec scraper node dist/cli.js ZAP,VIVA_REAL
 *
 * Exits 1 if any source failed, so `make scrape` reports a broken parser
 * instead of looking like it worked. Use `node dist/doctor.js` to find out why.
 */
const log = logger('cli');

// Validated through the same allow-list as SCRAPE_SOURCES: a typo used to be
// accepted here and then blow up as "No parser registered for source ZAPP".
const sources = parseSources(process.argv[2] ?? config.sources.join(','));

runScrape(sources)
  .then((summary) => {
    const failed = summary.outcomes.filter((o) => o.status === 'FAILED');
    for (const outcome of summary.outcomes) {
      const detail = outcome.note ? ` — ${outcome.note}` : '';
      log.info(
        `${outcome.source}: ${outcome.status} · found ${outcome.found}, new ${outcome.created}, ` +
          `refreshed ${outcome.updated}${detail}`,
      );
    }
    if (failed.length) {
      log.error(`${failed.length} of ${summary.outcomes.length} source(s) failed`);
      process.exitCode = 1;
    }
  })
  .catch((err) => {
    log.error('run failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
