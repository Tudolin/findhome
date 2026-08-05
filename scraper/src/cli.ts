import type { PropertySource } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { runScrape } from './runner.js';

/**
 * One-shot run, for testing a parser without waiting for cron:
 *
 *   docker compose exec scraper node dist/cli.js
 *   docker compose exec scraper node dist/cli.js ZAP,VIVA_REAL
 */
const log = logger('cli');

const arg = process.argv[2];
const sources = (arg ? arg.split(',').map((s) => s.trim().toUpperCase()) : config.sources) as PropertySource[];

runScrape(sources)
  .catch((err) => {
    log.error('run failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
