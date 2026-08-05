import cron from 'node-cron';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { runScrape } from './runner.js';
import { startControlServer } from './server.js';

const log = logger('scheduler');

async function main() {
  if (!cron.validate(config.cron)) {
    throw new Error(`SCRAPE_CRON is not a valid cron expression: "${config.cron}"`);
  }

  log.info(`FindHome scraper starting`);
  log.info(`  sources:  ${config.sources.join(', ')}`);
  log.info(`  schedule: ${config.cron} (${config.timezone})`);
  log.info(`  pages:    ${config.maxPages} × ${config.pageSize} per source per target`);

  // Wait for Postgres. compose already gates on the healthcheck, but a
  // restarting DB should not kill the scraper.
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch {
      log.warn(`database not ready (attempt ${attempt}/30), retrying in 2s`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const task = cron.schedule(config.cron, () => {
    void runScrape().catch((err) => log.error('scheduled run crashed', err));
  }, { timezone: config.timezone });

  // Manual triggers ("Run scrape now" in the app, `make scrape-now`).
  const server = startControlServer();

  if (config.runOnStart) {
    log.info('SCRAPE_ON_START=true — running one pass now');
    void runScrape().catch((err) => log.error('startup run crashed', err));
  }

  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down`);
    task.stop();
    server?.close();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(async (err) => {
  log.error('fatal', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
